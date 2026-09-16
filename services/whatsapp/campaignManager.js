const Campaign = require('../../models/Campaign');
const Customer = require('../../models/Customer');
const Message = require('../../models/Message');
const connectionManager = require('./connectionManager');

// Helper for delay
const randomDelay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

function getCleanName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'Boss';
  let trimmed = rawName.trim();
  const junkPattern = /^(test|unknown|customer|client|contact|no name|noname|admin|user|temp|demo|xyz|abc|[0-9\+\-\s\.\_]+)$/i;
  
  if (trimmed.length < 3 || junkPattern.test(trimmed) || /\d{5,}/.test(trimmed)) {
    return 'Boss';
  }
  
  const clean = trimmed.replace(/[^\w\s\u0900-\u097F]/gi, '').trim();
  if (!clean || clean.length < 2) return 'Boss';
  
  return clean;
}

// Track which tenants have a running processor
const activeProcessors = new Set();

async function startCampaignProcessor(tenantId) {
  console.log(`[Campaign Processor] Triggered processor for tenant ${tenantId}`);

  if (activeProcessors.has(tenantId.toString())) {
    console.log(`[Campaign Processor] Processor already active for tenant ${tenantId}. Loop will pick up updated settings.`);
    return;
  }

  try {
    activeProcessors.add(tenantId.toString());

    while (true) {
      // 1. Find the currently running campaign (oldest first)
      let campaign = await Campaign.findOne({ tenantId, status: 'running' }).sort({ createdAt: 1 });
      
      // 2. If no running campaign, check for the next pending (queued) campaign
      if (!campaign) {
        campaign = await Campaign.findOne({ tenantId, status: 'pending' }).sort({ createdAt: 1 });
        if (campaign) {
          campaign.status = 'running';
          await campaign.save();
          console.log(`[Campaign Processor] 🔥 Promoted queued campaign "${campaign.name}" (${campaign._id}) to RUNNING!`);
          const { getIo } = require('../../config/socket');
          const io = getIo();
          if (io) io.to(tenantId.toString()).emit('campaign-progress', { campaignId: campaign._id, campaign });
        }
      }

      if (!campaign) {
        // No running or pending campaigns, exit the loop
        activeProcessors.delete(tenantId.toString());
        console.log(`[Campaign Processor] Stopped for tenant ${tenantId} (No running/pending campaigns in queue)`);
        return;
      }

      const sock = connectionManager.getActiveSession(tenantId);
      if (!sock) {
        console.log(`[Campaign Processor] WhatsApp session not active. Pausing processor.`);
        activeProcessors.delete(tenantId.toString());
        return; // Pause processing if WhatsApp disconnects
      }

      // 🌙 24/7 Broadcast Engine: Run campaigns anytime (Day or Night) in ANY safety mode chosen by user

      // Check Anti-Ban Warmup Daily Quota Limit
      const { getTenantWarmupStatus, recordOutboundMessage } = require('../accountWarmupService');
      const warmup = await getTenantWarmupStatus(tenantId);

      if (warmup.dailyRemaining <= 0) {
        console.log(`[Campaign Processor] 🛡️ Anti-Ban Daily Limit Reached (${warmup.dailySent}/${warmup.dailyLimit} msgs) for tenant ${tenantId}. Pausing campaign.`);
        campaign.status = 'paused';
        campaign.pauseReason = `🛡️ Anti-Ban Daily Quota Reached (${warmup.dailySent}/${warmup.dailyLimit} msgs/day). Resumes tomorrow at 12:00 AM.`;
        await campaign.save();
        const { getIo } = require('../../config/socket');
        const io = getIo();
        if (io) io.to(tenantId.toString()).emit('campaign-progress', { campaignId: campaign._id, campaign });
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
      let remoteJid = `${phone}@s.whatsapp.net`;

      // Check if contact is blacklisted by user (Excluded from Campaigns)
      const Customer = require('../../models/Customer');
      const targetCustomer = await Customer.findOne({ 
        tenantId, 
        $or: [{ whatsappNumber: remoteJid }, { whatsappNumber: `${phone}@s.whatsapp.net` }, { whatsappNumber: phone }] 
      });

      if (targetCustomer && targetCustomer.isBlacklisted) {
        console.log(`[Campaign] 🚫 Number ${phone} is BLACKLISTED. Skipping broadcast.`);
        campaign.contacts[pendingContactIndex].status = 'ignored';
        campaign.contacts[pendingContactIndex].error = 'Blacklisted / Excluded from campaigns';
        campaign.progress.ignored = (campaign.progress.ignored || 0) + 1;
        await campaign.save();

        const { getIo } = require('../../config/socket');
        const io = getIo();
        if (io) {
          io.to(tenantId.toString()).emit('campaign-progress', { campaignId: campaign._id, campaign });
        }
        continue;
      }

      // Check if number exists on WhatsApp
      let whatsappCheck = null;
      try {
        whatsappCheck = await sock.onWhatsApp(phone);
      } catch (chkErr) {
        console.error(`[Campaign] Error checking onWhatsApp for ${phone}:`, chkErr.message);
      }

      const existsOnWa = Array.isArray(whatsappCheck) && whatsappCheck.length > 0 && whatsappCheck[0]?.exists;
      
      // 🧠 Ensure exact JID returned by WhatsApp (e.g. valid @s.whatsapp.net format)
      if (existsOnWa && whatsappCheck[0].jid) {
        remoteJid = whatsappCheck[0].jid;
      }

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

      // Re-fetch fresh campaign template prompt from database so mid-campaign prompt edits apply IMMEDIATELY to the next contact!
      const currentCampaignDoc = await Campaign.findById(campaign._id);
      const activeTemplatePrompt = (currentCampaignDoc && currentCampaignDoc.template) ? currentCampaignDoc.template : campaign.template;

      // Fallback: Default to raw campaign template with clean name substitution in case Groq AI fails
      const cleanName = getCleanName(contact.name);
      let messageText = activeTemplatePrompt.replace(/\{name\}/gi, cleanName === 'Boss' ? 'Boss' : cleanName);

      try {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({
          apiKey: process.env.GROQ_API_KEY,
          baseURL: 'https://api.groq.com/openai/v1',
        });

        const aiPrompt = `You are a real human engineer chatting 1-on-1 with a colleague/client on WhatsApp.
Customer Name Context: "${cleanName}". If the name is "Boss" or generic, address them naturally as "Boss", "Sir", or "Ji", or omit addressing them by name if awkward. DO NOT use weird/junk names, single letters, numbers, or abusive placeholders.

Your ONLY task is to write a single, completely natural, 100% HUMAN WhatsApp message based on this goal/instruction:
"${activeTemplatePrompt}"

CRITICAL RULES FOR 100% HUMAN SIMULATION (NO AI LOOK & NO BAN):
1. Sound 100% like a real person typing casually on WhatsApp in natural Hinglish.
2. ABSOLUTELY NO AI HEADERS, NO BOLD LISTS, NO STAR MARKS (*), NO EMOJI OVERLOAD, NO FORMAL BROCHURES.
3. Write in smooth, continuous conversational paragraphs just like a real friend or developer typing from their phone.
4. Output ONLY the raw message text. DO NOT include markdown, quote marks, or AI commentary.
5. Use realistic typing variations and warm human phrasing every time.`;

        const completion = await openai.chat.completions.create({
          model: 'groq/compound-mini',
          messages: [{ role: 'user', content: aiPrompt }],
          temperature: 0.9, // Higher temp for more variety
        });
        const aiRes = (completion.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (aiRes && aiRes.length > 5) {
          messageText = aiRes;
        }
      } catch (aiErr) {
        console.warn(`[Campaign] ⚠️ Groq AI API Quota/Limit Warning for ${phone}: ${aiErr.message}. Falling back to raw template message.`);
        // Fallback: Use the original template text so campaign message sends smoothly without stopping!
      }

      // 🛡️ ANTI-BAN SHIELD 1: Check for URLs & 2-Step Broadcast logic
      let extractedUrl = '';
      const urlRegex = /(https?:\/\/[^\s]+)/gi;
      const urlMatches = messageText.match(urlRegex);

      if (urlMatches && urlMatches.length > 0) {
        extractedUrl = urlMatches[0];
      }

      // Find or create Customer to check previous interaction history
      let cust = await Customer.findOne({ tenantId, whatsappNumber: remoteJid });
      if (!cust) {
        cust = await Customer.create({ tenantId, whatsappNumber: remoteJid, name: contact.name || phone });
      }

      // If 2-Step Shield is ENABLED (default true) and message has a URL link:
      if (campaign.enableTwoStepShield !== false && extractedUrl) {
        // Strip URL from initial broadcast message to avoid WhatsApp automated link spam detection
        messageText = messageText.replace(urlRegex, '').trim();
        // Clean up any double spaces or dangling pointers
        messageText = messageText.replace(/👉\s*$/g, '').replace(/:\s*$/g, '.').trim();

        // Save URL in customer.pendingFollowupLink so AI sends it on reply!
        cust.pendingFollowupLink = extractedUrl;
        await cust.save();
        console.log(`[Anti-Ban Shield] 🛡️ Stripped URL from cold broadcast for ${phone}. Saved pending link: ${extractedUrl}`);
      }

      // 🛡️ ANTI-BAN SHIELD 2: Auto Opt-Out Footer
      if (campaign.autoOptOutFooter !== false && !messageText.toLowerCase().includes('stop')) {
        messageText += `\n\n_(Reply STOP to opt out)_`;
      }

      try {
        // Set processing start timestamp on contact
        campaign.contacts[pendingContactIndex].processedAt = new Date();
        await campaign.save();

        console.log(`[Campaign] Dispatching message for ${phone}:\n${messageText}`);
        
        // Anti-ban: Dynamic Word-Count Based Human Typing Speed (Average ~40 WPM + Human Thinking Pause)
        const wordCount = messageText.trim().split(/\s+/).length;
        // Average human typing speed: ~200-300ms per character / 300ms per word + random 2-6s thinking pause
        const baseTypingMs = Math.max(4000, Math.min(wordCount * 400, 25000)); 
        const randomPauseMs = Math.floor(Math.random() * 4000) + 2000; // Extra 2-6s human pause
        const totalTypingDuration = baseTypingMs + randomPauseMs;

        await sock.sendPresenceUpdate('available');
        await randomDelay(1000, 2500);
        await sock.sendPresenceUpdate('composing', remoteJid);
        
        console.log(`[Campaign Human Typing Simulator] ⌨️ Words: ${wordCount}. Showing "typing..." for ${Math.round(totalTypingDuration/1000)} seconds to ${phone}...`);
        await randomDelay(totalTypingDuration, totalTypingDuration + 500);
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

        // ⏱️ 15-Second Hard Timeout Guard to prevent infinite hang on stale socket
        const sendWithTimeout = async () => {
          return Promise.race([
            sock.sendMessage(remoteJid, messagePayload),
            new Promise((_, reject) => setTimeout(() => reject(new Error('WhatsApp socket send timeout (15s exceeded)')), 15000))
          ]);
        };

        const sentMsg = await sendWithTimeout();
        await recordOutboundMessage(tenantId);
        
        const nowTime = new Date();
        const startProcTime = campaign.contacts[pendingContactIndex].processedAt || nowTime;
        const durationMs = Math.max(0, nowTime - new Date(startProcTime));

        // Update contact status & record exact duration
        campaign.contacts[pendingContactIndex].status = 'sent';
        campaign.contacts[pendingContactIndex].sentAt = nowTime;
        campaign.contacts[pendingContactIndex].executionDurationMs = durationMs;
        campaign.progress.sent += 1;

        // Ensure customer record updated
        if (!cust) cust = await Customer.findOne({ tenantId, whatsappNumber: remoteJid });
        
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
        console.error(`[Campaign] Failed to send to ${phone}:`, err.message);
        
        // 🔄 Smart Auto-Retry Guard: If timeout occurred due to temporary socket freeze, retry ONCE after short session check
        if (err.message && err.message.includes('timeout')) {
          console.log(`[Campaign Retry Guard] 🔄 Timeout detected for ${phone}. Checking active session & retrying once...`);
          const activeSock = connectionManager.getActiveSession(tenantId);
          if (activeSock) {
            try {
              await randomDelay(3000, 5000);
              const retryMsg = await activeSock.sendMessage(remoteJid, messagePayload);
              await recordOutboundMessage(tenantId);
              
              campaign.contacts[pendingContactIndex].status = 'sent';
              campaign.progress.sent += 1;
              console.log(`[Campaign Retry Guard] ✅ Retry SUCCESSFUL for ${phone}!`);
            } catch (retryErr) {
              console.error(`[Campaign Retry Guard] ❌ Retry failed for ${phone}:`, retryErr.message);
              campaign.contacts[pendingContactIndex].status = 'failed';
              campaign.contacts[pendingContactIndex].error = `Network/Socket Timeout: ${retryErr.message}`;
              campaign.progress.failed += 1;
            }
          } else {
            campaign.contacts[pendingContactIndex].status = 'failed';
            campaign.contacts[pendingContactIndex].error = 'WhatsApp disconnected during send';
            campaign.progress.failed += 1;
          }
        } else {
          campaign.contacts[pendingContactIndex].status = 'failed';
          campaign.contacts[pendingContactIndex].error = err.message;
          campaign.progress.failed += 1;
        }
      }

      await campaign.save();

      // Emit progress to dashboard
      const { getIo } = require('../../config/socket');
      const io = getIo();
      if (io) {
        io.to(tenantId.toString()).emit('campaign-progress', { campaignId: campaign._id, campaign });
      }

      // Re-fetch fresh campaign settings from DB so mid-campaign speed/prompt updates reflect IMMEDIATELY without waiting for next loop!
      const freshCampaign = await Campaign.findById(campaign._id);
      
      if (!freshCampaign || freshCampaign.status !== 'running') {
        console.log(`[Campaign Processor] Campaign ${campaign._id} status is no longer running (${freshCampaign?.status}). Exiting loop cycle.`);
        activeProcessors.delete(tenantId.toString());
        return;
      }

      const currentSafetyMode = freshCampaign.safetyMode || campaign.safetyMode;
      const currentMinSec = freshCampaign.customDelayMinSeconds || campaign.customDelayMinSeconds;
      const currentMaxSec = freshCampaign.customDelayMaxSeconds || campaign.customDelayMaxSeconds;

      // Anti-ban delay based on selected safety mode
      let minDelay = 45000; // Default Safe Mode: 45s to 90s per msg
      let maxDelay = 90000;
      
      if (currentSafetyMode === 'custom') {
        minDelay = (currentMinSec || 15) * 1000;
        maxDelay = (currentMaxSec || 40) * 1000;
      } else if (currentSafetyMode === 'fast') {
        minDelay = 8000;  // 8s - 15s
        maxDelay = 15000;
      } else if (currentSafetyMode === 'balanced') {
        minDelay = 20000; // 20s - 40s
        maxDelay = 40000;
      } else if (currentSafetyMode === 'safe') {
        minDelay = 45000; // 45s - 90s
        maxDelay = 90000;
      } else if (currentSafetyMode === 'stealth') {
        minDelay = 120000; // 2 mins - 4 mins
        maxDelay = 240000;
      }

      console.log(`[Campaign] 🛡️ Anti-Ban Pacing (${currentSafetyMode || 'safe'}): Waiting ${Math.round(minDelay/1000)} to ${Math.round(maxDelay/1000)} seconds before next contact...`);
      await randomDelay(minDelay, maxDelay);
    }
  } catch (error) {
    console.error(`[Campaign Processor] Fatal Error:`, error);
    activeProcessors.delete(tenantId);
  }
}

function resetProcessorLock(tenantId) {
  if (tenantId) {
    activeProcessors.delete(tenantId.toString());
    console.log(`[Campaign Processor] 🔓 Force-cleared active processor lock for tenant ${tenantId}`);
  }
}

module.exports = {
  startCampaignProcessor,
  resetProcessorLock
};
