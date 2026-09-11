const Customer = require('../../models/Customer');
const Message = require('../../models/Message');
const Tenant = require('../../models/Tenant');
const { generateAIResponse } = require('../aiService');

// Queueing system for sequential processing
const messageQueues = new Map(); // Key: `${tenantId}_${remoteJid}`, Value: Array of messages
const processingQueues = new Set(); // Tracks which queues are currently processing

// Helper to simulate randomized human delay
const randomDelay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

/**
 * Process queued messages for a specific customer sequentially
 */
async function processQueue(tenantId, remoteJid, sock, io) {
  const queueKey = `${tenantId}_${remoteJid}`;
  if (processingQueues.has(queueKey)) return; // Already processing this customer

  processingQueues.add(queueKey);

  try {
    const queue = messageQueues.get(queueKey);
    
    while (queue && queue.length > 0) {
      const msgData = queue.shift(); // Get oldest message
      const { textContent, messageKey, pushName, mediaOpts } = msgData;

      try {
        // Fetch Tenant for settings (like Ghost Mode, AI Auto-Reply Switch)
        const tenant = await Tenant.findById(tenantId);
        
        // 1. Find or create Customer
        let customer = await Customer.findOne({ 
          tenantId, 
          $or: [{ whatsappNumber: remoteJid }, { aliasIds: remoteJid }]
        });

        if (!customer) {
          const isLid = remoteJid.includes('@lid');
          let pName = pushName;
          if (!pName || (/^\d+$/.test(pName) && pName.length > 13)) {
            pName = isLid ? 'WhatsApp User (Private ID)' : `+${remoteJid.split('@')[0]}`;
          }

          if (isLid && pName !== 'WhatsApp User (Private ID)') {
            const matches = await Customer.find({ tenantId, name: pName });
            if (matches.length === 1) {
              customer = matches[0];
              customer.aliasIds.push(remoteJid);
              await customer.save();
            }
          }
          
          if (!customer) {
            try {
              customer = await Customer.create({
                tenantId,
                whatsappNumber: remoteJid,
                name: pName,
                aiPaused: tenant?.aiAutoReplyDisabled || false
              });
            } catch (err) {
              customer = await Customer.findOne({ tenantId, whatsappNumber: remoteJid });
            }
          }
        }

        // Fetch DP and About if missing or occasionally
        if (!customer.profilePic || !customer.about) {
          let updated = false;
          
          if (!customer.profilePic) {
            try {
              const dpUrl = await sock.profilePictureUrl(remoteJid, 'image');
              if (dpUrl) {
                customer.profilePic = dpUrl;
                updated = true;
              }
            } catch (err) { /* Ignored */ }
          }

          if (!customer.about) {
            try {
              const statusData = await sock.fetchStatus(remoteJid);
              if (statusData && statusData.status) {
                customer.about = statusData.status;
                updated = true;
              }
            } catch (err) { /* Ignored */ }
          }

          if (updated) {
            await customer.save();
          }
        }
        
        // Update deviceType and lastActiveAt if provided
        if (mediaOpts && mediaOpts.deviceType && (customer.deviceType !== mediaOpts.deviceType)) {
          customer.deviceType = mediaOpts.deviceType;
          customer.lastActiveAt = new Date();
          await customer.save();
        } else {
          customer.lastActiveAt = new Date();
          await customer.save();
        }

        const ActivityLog = require('../../models/ActivityLog');
        await ActivityLog.create({
          tenantId,
          customerId: customer._id,
          actionType: 'message_sent'
        });

        // 2. Save incoming message to DB
        const incomingMsg = await Message.create({
          tenantId,
          customerId: customer._id,
          sender: 'customer',
          content: textContent,
          messageId: messageKey.id,
          ...(mediaOpts || {})
        });
        
        // EMIT TO DASHBOARD
        if (io) {
          io.to(tenantId).emit('new-message', { customerId: customer._id, message: incomingMsg });
        }

        // 3. Realistic Read Receipts Flow (Ghost Mode Check)
        if (!tenant || !tenant.ghostMode) {
          await randomDelay(200, 500);
          await sock.sendPresenceUpdate('available');
          await sock.readMessages([messageKey]);
          await randomDelay(200, 500);
        } else {
          console.log(`[Tenant ${tenantId}] 👻 Ghost Mode Active: Skipped reading message from ${remoteJid}`);
        }

        // Check if AI Auto-Reply is paused globally or for this customer (Human-in-the-loop)
        if (tenant?.aiAutoReplyDisabled || customer.aiPaused) {
          console.log(`[Tenant ${tenantId}] 🛑 AI Auto-Reply is OFF (Global: ${tenant?.aiAutoReplyDisabled}, Customer: ${customer.aiPaused}). Skipping AI auto-reply.`);
          continue;
        }

        // --- ACCOUNT WARMUP & ANTI-BAN TIER CHECK ---
        const { getTenantWarmupStatus, recordOutboundMessage } = require('../accountWarmupService');
        const warmup = await getTenantWarmupStatus(tenantId);

        if (warmup.dailyRemaining <= 0) {
          console.log(`[Tenant ${tenantId}] 🛡️ Anti-Ban Daily Limit Reached (${warmup.dailySent}/${warmup.dailyLimit} msgs). Pausing automated replies today to protect WhatsApp account.`);
          if (io) io.to(tenantId).emit('warmup-limit-reached', { warmup });
          continue;
        }

        // --- BUSINESS HOURS CHECK ---
        const currentHour = new Date().getHours();
        let isOutOfHours = false;
        const outOfHoursAction = tenant?.businessHours?.outOfHoursAction || 'ai_natural';
        
        if (tenant && tenant.businessHours) {
          const startHour = parseInt(tenant.businessHours.start.split(':')[0]);
          const endHour = parseInt(tenant.businessHours.end.split(':')[0]);
          if (currentHour < startHour || currentHour >= endHour) {
            isOutOfHours = true;
          }
        }

        if (isOutOfHours && outOfHoursAction === 'silent') {
          console.log(`[Tenant ${tenantId}] 🌙 Out of hours (Silent Mode Active). Skipping response to ${remoteJid}`);
          continue;
        }

        let aiReply = "";
        
        if (isOutOfHours && outOfHoursAction === 'template') {
          aiReply = tenant?.businessHours?.outOfHoursMessage || "We are currently closed. We will reply as soon as we open.";
        } else {
          // ── Pre-AI Keyword Intent Detection ──
          const Appointment = require('../../models/Appointment');
          const msgLower = textContent.toLowerCase().trim();

          const cancelKeywords   = ['cancel', 'band karo', 'nahi chahiye', 'mat karo', 'hatao', 'delete kro', 'cancel kro', 'cancel kar', 'cancel kr'];
          const rescheduleKeywords = ['reschedule', 'change karo', 'change kr', 'alag time', 'shift karo', 'shift kr', 'time badlo', 'date badlo', 'resedul', 'reschedual', 'baad mein', 'later rakh'];

          const isCancelIntent    = cancelKeywords.some(kw => msgLower.includes(kw));
          const isRescheduleIntent = rescheduleKeywords.some(kw => msgLower.includes(kw));

          if (isCancelIntent || isRescheduleIntent) {
            const activeBooking = await Appointment.findOne({
              tenantId, customerId: customer._id, status: { $in: ['PENDING', 'CONFIRMED'] }
            });

            if (activeBooking && isCancelIntent) {
              await Appointment.findByIdAndUpdate(activeBooking._id, { status: 'CANCELLED' });
              console.log(`[Queue] ❌ Booking cancelled directly for ${customer.name} (keyword: "${msgLower}")`);
              aiReply = `Ji bilkul ${customer.name || ''}! Aapki appointment *${activeBooking.serviceName}* on *${activeBooking.date}* at *${activeBooking.time}* cancel kar di gayi hai. 😊`;
            } else if (activeBooking && isRescheduleIntent) {
              aiReply = await generateAIResponse(tenantId, customer._id, textContent);
            } else {
              aiReply = await generateAIResponse(tenantId, customer._id, textContent);
            }
          } else {
            if (io) io.to(tenantId).emit('bot-typing', { customerId: customer._id, isTyping: true });
            let inputMessage = textContent;
            if (isOutOfHours && outOfHoursAction === 'ai_natural') {
              inputMessage += ` [SYSTEM NOTE: It is currently outside business hours (closed). Respond naturally as a human assistant taking a note for the owner who will return tomorrow morning.]`;
            }
            aiReply = await generateAIResponse(tenantId, customer._id, inputMessage);
          }
        }
        
        if (aiReply) {
          const { processActionTags, processBookingTag } = require('../bookingService');
          aiReply = await processActionTags(tenantId, customer._id, aiReply);

          const bookingRegex = /\[CREATE_BOOKING:\s*([^\]]+)\]/gi;
          let bookingMatch;
          while ((bookingMatch = bookingRegex.exec(aiReply)) !== null) {
            const tagContent = bookingMatch[1];
            const result = await processBookingTag(tenantId, customer._id, tagContent);
            
            if (result.alreadyExists && result.existingBooking) {
              const eb = result.existingBooking;
              aiReply = aiReply.replace(bookingRegex, '').trim();
              aiReply += `\n\n⚠️ Aapki ek appointment pehle se active hai:\n*Service:* ${eb.serviceName}\n*Date:* ${eb.date} at ${eb.time}`;
            }
          }
          aiReply = aiReply.replace(/\[CREATE_BOOKING:\s*([^\]]+)\]/gi, '').trim();

          const assetRegex = /\[SEND_ASSET:\s*([a-zA-Z0-9_]+)\]/g;
          let match;
          const assetsToSend = [];
          while ((match = assetRegex.exec(aiReply)) !== null) {
            assetsToSend.push(match[1].toUpperCase());
          }
          
          aiReply = aiReply.replace(assetRegex, '').trim();

          const isVoiceEnabled = tenant && tenant.aiVoiceEnabled;
          const voiceMode = (tenant && tenant.aiVoiceMode) || 'both';
          
          const shouldSendText = !isVoiceEnabled || voiceMode === 'both' || voiceMode === 'text_only';
          const shouldSendVoice = isVoiceEnabled && (voiceMode === 'both' || voiceMode === 'voice_only');

          const chunks = aiReply.split('|||').map(c => c.trim()).filter(c => c.length > 0);
          
          if (shouldSendText) {
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              
              await sock.sendPresenceUpdate('composing', remoteJid);
              if (io && !isOutOfHours) io.to(tenantId).emit('bot-typing', { customerId: customer._id, isTyping: true });
              
              const calculatedTypingTime = Math.max(1500, Math.min(chunk.length * 45, 9000));
              const jitter = Math.floor(Math.random() * 800) - 400;
              const finalDelay = Math.max(1200, calculatedTypingTime + jitter);
              
              await randomDelay(finalDelay, finalDelay + 300);
              
              await sock.sendPresenceUpdate('paused', remoteJid);
              if (io) io.to(tenantId).emit('bot-typing', { customerId: customer._id, isTyping: false });

              const sentMsg = await sock.sendMessage(remoteJid, { text: chunk });
              await recordOutboundMessage(tenantId);

              const outboundMsg = await Message.create({
                tenantId,
                customerId: customer._id,
                sender: 'bot',
                content: chunk,
                messageId: sentMsg.key.id
              });
              
              if (io) {
                io.to(tenantId).emit('new-message', { customerId: customer._id, message: outboundMsg });
              }

              console.log(`[Tenant ${tenantId}] Replied to ${remoteJid}: Chunk ${i+1}/${chunks.length}`);
              
              if (i < chunks.length - 1) {
                await randomDelay(500, 1000);
              }
            }
          }

          if (shouldSendVoice && chunks.length > 0) {
            try {
              const { generateVoiceNote } = require('../ttsService');
              const fullTextForVoice = chunks.join('. ');
              const voiceLang = (tenant && tenant.aiVoiceLanguage) || 'hi';
              const voiceGender = (tenant && tenant.aiVoiceGender) || 'female';
              const voiceActor = (tenant && tenant.aiVoiceActor) || 'hi-IN-SwaraNeural';
              const voiceSpeed = (tenant && tenant.aiVoiceSpeed) || '+0%';
              
              const voiceData = await generateVoiceNote(fullTextForVoice, voiceLang, voiceGender, voiceActor, voiceSpeed);
              if (voiceData && voiceData.filePath) {
                await sock.sendPresenceUpdate('recording', remoteJid);
                await randomDelay(1500, 3000);
                
                const mime = voiceData.filePath.endsWith('.ogg') ? 'audio/ogg; codecs=opus' : 'audio/mp4';

                const sentAudio = await sock.sendMessage(remoteJid, {
                  audio: { url: voiceData.filePath },
                  mimetype: mime,
                  ptt: true
                });

                const audioMsg = await Message.create({
                  tenantId,
                  customerId: customer._id,
                  sender: 'bot',
                  content: `🎤 [AI Voice Note Sent]`,
                  mediaUrl: voiceData.publicUrl,
                  mediaType: 'audio',
                  messageId: sentAudio.key.id
                });

                if (io) {
                  io.to(tenantId).emit('new-message', { customerId: customer._id, message: audioMsg });
                }

                console.log(`[Tenant ${tenantId}] 🔥 AI Voice Note PTT sent to ${remoteJid}`);
              }
            } catch (vErr) {
              console.error(`[Tenant ${tenantId}] Error sending AI Voice Note:`, vErr);
            }
          }

          if (assetsToSend.length > 0) {
            const MediaAsset = require('../../models/MediaAsset');
            for (const keyword of assetsToSend) {
              const asset = await MediaAsset.findOne({ tenantId, keyword });
              if (asset) {
                const fs = require('fs');
                const path = require('path');
                const filePath = path.join(__dirname, '../../public/uploads', asset.filename);
                
                if (fs.existsSync(filePath)) {
                  await sock.sendPresenceUpdate('available', remoteJid);
                  await randomDelay(1000, 2000);
                  
                  let mediaMessage = {};
                  const mime = asset.mimetype || '';
                  if (mime.startsWith('image/')) {
                    mediaMessage = { image: { url: filePath } };
                  } else if (mime.startsWith('video/')) {
                    mediaMessage = { video: { url: filePath } };
                  } else {
                    mediaMessage = { document: { url: filePath }, mimetype: mime, fileName: asset.originalName };
                  }
                  
                  const sentAsset = await sock.sendMessage(remoteJid, mediaMessage);
                  
                  const outboundMsg = await Message.create({
                    tenantId,
                    customerId: customer._id,
                    sender: 'bot',
                    content: `📎 [Media Asset Sent: ${keyword}]`,
                    messageId: sentAsset.key.id
                  });
                  
                  if (io) io.to(tenantId).emit('new-message', { customerId: customer._id, message: outboundMsg });
                }
              }
            }
          }
        }

        await sock.sendPresenceUpdate('unavailable');

      } catch (innerError) {
        console.error(`[Queue Error] Error processing single message for user: ${remoteJid}`, innerError);
      }

      if (queue.length > 0) {
        await randomDelay(1500, 3000);
      }
    }
  } catch (error) {
    console.error(`[Queue Error] tenant: ${tenantId}, user: ${remoteJid}`, error);
  } finally {
    processingQueues.delete(queueKey);
  }
}

function addToQueue(tenantId, remoteJid, textContent, messageKey, pushName, sock, io, mediaOpts = {}) {
  const queueKey = `${tenantId}_${remoteJid}`;
  if (!messageQueues.has(queueKey)) {
    messageQueues.set(queueKey, []);
  }
  
  messageQueues.get(queueKey).push({ textContent, messageKey, pushName, mediaOpts });
  processQueue(tenantId, remoteJid, sock, io);
}

module.exports = {
  addToQueue
};
