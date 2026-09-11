const DripJob = require('../../models/DripJob');
const Campaign = require('../../models/Campaign');
const Customer = require('../../models/Customer');
const Message = require('../../models/Message');
const { getActiveSession } = require('./connectionManager');
const { OpenAI } = require('openai');
const { getIo } = require('../../config/socket');

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const randomDelay = (min, max) => new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));

async function processDripJobs() {
  try {
    const now = new Date();
    // Find all pending jobs that are due
    const pendingJobs = await DripJob.find({
      status: 'pending',
      executeAt: { $lte: now }
    });

    if (pendingJobs.length > 0) {
      console.log(`[DripService] Found ${pendingJobs.length} pending drip jobs to process...`);
    }

    for (const job of pendingJobs) {
      try {
        const tenantId = job.tenantId.toString();
        const sock = getActiveSession(tenantId);
        
        if (!sock) {
          console.log(`[DripService] Skipping job for tenant ${tenantId} - WhatsApp not connected`);
          continue; // Will retry next cycle
        }

        const customer = await Customer.findById(job.customerId);
        if (!customer) {
          job.status = 'failed';
          await job.save();
          continue;
        }

        const campaign = await Campaign.findById(job.campaignId);
        if (!campaign) {
          job.status = 'cancelled';
          await job.save();
          continue;
        }

        // Generate unique message
        const aiPrompt = `You are an expert copywriter sending a follow-up WhatsApp message to a customer named "${customer.name || 'Friend'}".
Your ONLY task is to write a single, short, completely unique WhatsApp message based on this goal/instruction:
"${job.template}"

Rules:
1. Make it sound extremely natural and human-like.
2. DO NOT include any markdown, quotation marks, or explanations in your response. Output ONLY the message text.
3. Keep it short.`;

        const completion = await openai.chat.completions.create({
          model: 'groq/compound-mini',
          messages: [{ role: 'user', content: aiPrompt }],
          temperature: 0.9,
        });
        const messageText = (completion.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // Simulate Typing
        const remoteJid = customer.whatsappNumber;
        await sock.sendPresenceUpdate('available');
        await randomDelay(1000, 2000);
        await sock.sendPresenceUpdate('composing', remoteJid);
        await randomDelay(3000, 5000);
        await sock.sendPresenceUpdate('paused', remoteJid);

        // Send
        const sentMsg = await sock.sendMessage(remoteJid, { text: messageText });

        // Save message to DB
        const phoneMsg = await Message.create({
          tenantId,
          customerId: customer._id,
          sender: 'agent',
          content: messageText,
          messageId: sentMsg.key.id
        });

        const io = getIo();
        if (io) io.to(tenantId).emit('new-message', { customerId: customer._id, message: phoneMsg });

        // Mark current job completed
        job.status = 'completed';
        await job.save();

        console.log(`[DripService] Sent follow-up to ${customer.whatsappNumber}`);

        // Schedule Next Node if exists
        const nextNodeIndex = job.nodeIndex + 1;
        if (campaign.dripNodes && nextNodeIndex < campaign.dripNodes.length) {
          const nextNode = campaign.dripNodes[nextNodeIndex];
          await DripJob.create({
            tenantId,
            customerId: customer._id,
            campaignId: campaign._id,
            nodeIndex: nextNodeIndex,
            template: nextNode.template,
            executeAt: new Date(Date.now() + nextNode.delayHours * 3600000)
          });
          console.log(`[DripService] Scheduled next node (Index ${nextNodeIndex}) for ${customer.whatsappNumber} at ${nextNode.delayHours} hours from now.`);
        }

      } catch (err) {
        console.error(`[DripService] Error processing job ${job._id}:`, err);
        // Don't mark as failed if it's a network issue, maybe increment a retry count in the future.
        // For now, let's keep it pending so it retries, unless it's a hard fail.
      }
    }
  } catch (error) {
    console.error('[DripService] Main loop error:', error);
  }
}

// Start cron - runs every 5 minutes
function startDripService() {
  console.log('[DripService] Started automated follow-up scheduler (Cron: 5 mins)');
  setInterval(processDripJobs, 5 * 60 * 1000); 
  // Run once immediately on boot
  setTimeout(processDripJobs, 5000);
}

module.exports = { startDripService };
