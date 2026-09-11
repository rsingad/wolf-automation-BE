const Campaign = require('../../models/Campaign');
const Customer = require('../../models/Customer');
const Message = require('../../models/Message');
const connectionManager = require('./connectionManager');

// Helper for delay
const randomDelay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

// Track which tenants have a running processor
const activeProcessors = new Set();

async function startCampaignProcessor(tenantId) {
  if (activeProcessors.has(tenantId)) return;
  activeProcessors.add(tenantId);

  console.log(`[Campaign Processor] Started for tenant ${tenantId}`);

  try {
    while (true) {
      // Find a running campaign for this tenant
      const campaign = await Campaign.findOne({ tenantId, status: 'running' });
      
      if (!campaign) {
        // No running campaigns, exit the loop
        activeProcessors.delete(tenantId);
        console.log(`[Campaign Processor] Stopped for tenant ${tenantId} (No running campaigns)`);
        return;
      }

      const sock = connectionManager.getActiveSession(tenantId);
      if (!sock) {
        console.log(`[Campaign Processor] WhatsApp session not active. Pausing processor.`);
        activeProcessors.delete(tenantId);
        return; // Pause processing if WhatsApp disconnects
      }

      // Check Anti-Ban Warmup Daily Quota Limit
      const { getTenantWarmupStatus, recordOutboundMessage } = require('../accountWarmupService');
      const warmup = await getTenantWarmupStatus(tenantId);

      if (warmup.dailyRemaining <= 0) {
        console.log(`[Campaign Processor] 🛡️ Anti-Ban Daily Limit Reached (${warmup.dailySent}/${warmup.dailyLimit} msgs) for tenant ${tenantId}. Pausing campaign.`);
        campaign.status = 'paused';
        await campaign.save();
        const { getIo } = require('../../config/socket');
        const io = getIo();
        if (io) io.to(tenantId.toString()).emit('warmup-limit-reached', { warmup, campaignId: campaign._id });
        activeProcessors.delete(tenantId);
        return;
      }

      // Find the first pending contact
      const pendingContactIndex = campaign.contacts.findIndex(c => c.status === 'pending');
      
      if (pendingContactIndex === -1) {
        // All contacts processed! Mark campaign as completed
        campaign.status = 'completed';
        await campaign.save();
        
        const { getIo } = require('../../config/socket');
        const io = getIo();
        if (io) io.to(tenantId.toString()).emit('campaign-progress', { campaignId: campaign._id, campaign });
        continue; // Check for next campaign
      }

      const contact = campaign.contacts[pendingContactIndex];
      
      // Format phone number
      let phone = contact.phone.toString().replace(/[^0-9]/g, '');
      // If it starts with 0 and is 11 digits (e.g. 09999999999), strip the 0
      if (phone.startsWith('0') && phone.length === 11) {
        phone = phone.substring(1);
      }
      // If it is 10 digits, assume India and add 91
      if (phone.length === 10) {
        phone = `91${phone}`;
      }
      const remoteJid = `${phone}@s.whatsapp.net`;

      // Check if number exists on WhatsApp
      let whatsappCheck = null;
      try {
        whatsappCheck = await sock.onWhatsApp(phone);
      } catch (chkErr) {
        console.error(`[Campaign] Error checking onWhatsApp for ${phone}:`, chkErr.message);
      }

      const existsOnWa = Array.isArray(whatsappCheck) && whatsappCheck.length > 0 && whatsappCheck[0]?.exists;
      if (!existsOnWa) {
        console.log(`[Campaign] ⚠️ Number ${phone} is NOT on WhatsApp. Marking as ignored.`);
        campaign.contacts[pendingContactIndex].status = 'ignored';
        campaign.contacts[pendingContactIndex].error = 'No WhatsApp account found for this number';
        campaign.progress.ignored = (campaign.progress.ignored || 0) + 1;
        await campaign.save();

        const { getIo } = require('../../config/socket');
        const io = getIo();
        if (io) {
          io.to(tenantId.toString()).emit('campaign-progress', { campaignId: campaign._id, campaign });
        }

        await randomDelay(1000, 1500);
        continue; // Skip to next contact immediately
      }

      // Remove manual Spintax parser. We will use Groq AI to generate a unique message.
      const { OpenAI } = require('openai');
      const openai = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      });

      // Dynamically generate message using AI
      let messageText = "Hello";
      try {
        const aiPrompt = `You are an expert copywriter sending a WhatsApp message to a customer named "${contact.name || 'Friend'}".
Your ONLY task is to write a single, short, completely unique WhatsApp message based on this goal/instruction:
"${campaign.template}"

Rules:
1. Make it sound extremely natural and human-like.
2. DO NOT include any markdown, quotation marks, or explanations in your response. Output ONLY the message text.
3. Be creative, use different greetings and sentence structures every time.
4. Keep it relatively short (under 3 sentences) unless the goal specifies otherwise.`;

        const completion = await openai.chat.completions.create({
          model: 'groq/compound-mini',
          messages: [{ role: 'user', content: aiPrompt }],
          temperature: 0.9, // Higher temp for more variety
        });
        messageText = (completion.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        
        console.log(`[Campaign] Generated unique message for ${phone}:\n${messageText}`);
        
        // Anti-ban: Presence
        await sock.sendPresenceUpdate('available');
        await randomDelay(1000, 2000);
        await sock.sendPresenceUpdate('composing', remoteJid);
        
        // Typing delay (e.g. 3-6 seconds)
        await randomDelay(3000, 6000);
        await sock.sendPresenceUpdate('paused', remoteJid);
        
        // Send (Photo with Caption or Text Message)
        let messagePayload = { text: messageText };

        if (campaign.mediaUrl && campaign.mediaUrl.trim()) {
          const path = require('path');
          const fs = require('fs');
          const mediaUrl = campaign.mediaUrl.trim();

          if (mediaUrl.startsWith('/uploads/') || mediaUrl.startsWith('uploads/')) {
            const filename = mediaUrl.replace(/^\/?uploads\//, '');
            const localFilePath = path.join(__dirname, '../../public/uploads', filename);
            if (fs.existsSync(localFilePath)) {
              messagePayload = {
                image: fs.readFileSync(localFilePath),
                caption: messageText
              };
            } else {
              console.warn(`[CampaignManager] Local media file not found: ${localFilePath}. Falling back to text-only message.`);
              messagePayload = { text: messageText };
            }
          } else if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
            messagePayload = {
              image: { url: mediaUrl },
              caption: messageText
            };
          } else {
            console.warn(`[CampaignManager] Unrecognized media URL: ${mediaUrl}. Falling back to text-only message.`);
            messagePayload = { text: messageText };
          }
        }

        const sentMsg = await sock.sendMessage(remoteJid, messagePayload);
        await recordOutboundMessage(tenantId);
        
        // Update contact status
        campaign.contacts[pendingContactIndex].status = 'sent';
        campaign.progress.sent += 1;

        // Create Customer and Message in DB for history
        let cust = await Customer.findOne({ tenantId, whatsappNumber: remoteJid });
        if (!cust) cust = await Customer.create({ tenantId, whatsappNumber: remoteJid, name: contact.name || phone });
        
        await Message.create({
          tenantId,
          customerId: cust._id,
          sender: 'agent', // Treat campaign as agent/bot
          content: messageText,
          messageId: sentMsg.key.id
        });

        // Phase 21: Schedule First Drip Job (if any)
        if (campaign.dripNodes && campaign.dripNodes.length > 0) {
          const DripJob = require('../../models/DripJob');
          const firstNode = campaign.dripNodes[0];
          
          await DripJob.create({
            tenantId,
            customerId: cust._id,
            campaignId: campaign._id,
            nodeIndex: 0,
            template: firstNode.template,
            executeAt: new Date(Date.now() + firstNode.delayHours * 3600000)
          });
          
          console.log(`[Campaign] Scheduled next drip node for ${phone} at ${firstNode.delayHours} hours from now.`);
        }

      } catch (err) {
        console.error(`[Campaign] Failed to send to ${phone}`, err.message);
        campaign.contacts[pendingContactIndex].status = 'failed';
        campaign.contacts[pendingContactIndex].error = err.message;
        campaign.progress.failed += 1;
      }

      await campaign.save();

      // Emit progress to dashboard
      const { getIo } = require('../../config/socket');
      const io = getIo();
      if (io) {
        io.to(tenantId.toString()).emit('campaign-progress', { campaignId: campaign._id, campaign });
      }

      // Anti-ban delay based on selected safety mode
      let minDelay = 25000;
      let maxDelay = 50000;
      if (campaign.safetyMode === 'fast') {
        minDelay = 8000;
        maxDelay = 15000;
      } else if (campaign.safetyMode === 'balanced') {
        minDelay = 15000;
        maxDelay = 30000;
      } else { // 'safe' (Ultra Safety 25-50s)
        minDelay = 25000;
        maxDelay = 50000;
      }

      console.log(`[Campaign] Anti-Ban Safety (${campaign.safetyMode || 'safe'}): Waiting ${Math.round(minDelay/1000)}-${Math.round(maxDelay/1000)} seconds...`);
      await randomDelay(minDelay, maxDelay);
    }
  } catch (error) {
    console.error(`[Campaign Processor] Fatal Error:`, error);
    activeProcessors.delete(tenantId);
  }
}

module.exports = {
  startCampaignProcessor
};
