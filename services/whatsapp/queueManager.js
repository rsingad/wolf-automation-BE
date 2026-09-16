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

        // 3. Realistic Read Receipts Flow (Human Reading Delay of 1.5s to 3.5s)
        if (!tenant || !tenant.ghostMode) {
          // Human Thinking/Reading Delay: Wait 1.5s - 3.5s before opening chat & marking read!
          await randomDelay(1500, 3500);
          await sock.sendPresenceUpdate('available');
          await sock.readMessages([messageKey]);
          await randomDelay(800, 1500);
        } else {
          console.log(`[Tenant ${tenantId}] 👻 Ghost Mode Active: Skipped reading message from ${remoteJid}`);
        }

        // 🤫 IGNORE PREFIX FILTER (Idea 1): Skip AI if message starts with // or # or [test] or [skip]
        const trimmedText = (textContent || '').trim();
        if (trimmedText.startsWith('//') || trimmedText.startsWith('#') || trimmedText.toLowerCase().startsWith('[test]') || trimmedText.toLowerCase().startsWith('[skip]')) {
          console.log(`[Queue] 🤫 Message starts with ignore prefix ('//' or '#'). Skipping AI auto-reply.`);
          customer.aiStatusState = 'SKIPPED_PREFIX';
          customer.lastResponseReason = `🤫 Skipped AI reply because message starts with ignore prefix ("${trimmedText.slice(0, 5)}")`;
          await customer.save();
          if (io) io.to(tenantId).emit('customer-updated', customer);
          continue;
        }

        // 🛑 AUTOMATED OPT-OUT (STOP KEYWORD) HANDLER
        const optOutKeywords = ['stop', 'unsubscribe', 'mat bhejo', 'band karo', 'hatao', 'remove me'];
        if (optOutKeywords.some(kw => trimmedText.toLowerCase() === kw || trimmedText.toLowerCase().startsWith(`${kw} `))) {
          console.log(`[Queue] 🛑 Opt-out keyword detected from ${customer.name || remoteJid}. Blacklisting and unsubscribing.`);
          customer.isBlacklisted = true;
          customer.aiPaused = true;
          customer.aiStatusState = 'PAUSED_MANUAL';
          customer.lastResponseReason = '🛑 User requested Opt-Out / STOP';
          await customer.save();

          const stopMsgText = "Aapko hamari broadcast list se remove kar diya gaya hai. Ab aapko koi promotional message nahi aayega. Thank you! 🙏";
          const sentStop = await sock.sendMessage(remoteJid, { text: stopMsgText });
          await Message.create({
            tenantId,
            customerId: customer._id,
            sender: 'bot',
            content: stopMsgText,
            messageId: sentStop.key.id
          });
          if (io) io.to(tenantId).emit('customer-updated', customer);
          continue;
        }

        // ⏱️ DYNAMIC AUTO-RESUME TIMER CHECK FOR MANUAL MESSAGES
        if (customer.aiPaused && customer.aiPausedUntil) {
          const now = new Date();
          if (now >= new Date(customer.aiPausedUntil)) {
            // Timer expired! Auto-resume AI!
            customer.aiPaused = false;
            customer.aiPausedUntil = null;
            customer.aiStatusState = 'ACTIVE_AI';
            customer.lastResponseReason = '⚡ AI Auto-Resumed after human manual takeover inactivity window!';
            await customer.save();
            console.log(`[Queue Dynamic Timer] ⚡ Manual pause expired! Auto-resuming AI for ${customer.name || customer._id}`);
            if (io) io.to(tenantId).emit('customer-updated', customer);
          }
        }

        // Check if AI Auto-Reply is paused globally or for this customer (Human-in-the-loop)
        if (tenant?.aiAutoReplyDisabled || customer.aiPaused) {
          console.log(`[Tenant ${tenantId}] 🛑 AI Auto-Reply is OFF (Global: ${tenant?.aiAutoReplyDisabled}, Customer: ${customer.aiPaused}). Skipping AI auto-reply.`);
          customer.aiStatusState = tenant?.aiAutoReplyDisabled ? 'SKIPPED_GLOBAL_OFF' : 'PAUSED_MANUAL';
          
          const timeoutMins = tenant?.humanTakeoverResumeMinutes !== undefined ? tenant.humanTakeoverResumeMinutes : 30;
          const remainingMins = customer.aiPausedUntil 
            ? Math.max(1, Math.ceil(((new Date(customer.aiPausedUntil) - new Date()) / 1000) / 60))
            : timeoutMins;

          customer.lastResponseReason = tenant?.aiAutoReplyDisabled 
            ? '🌐 AI is disabled globally in System Settings' 
            : (timeoutMins > 0 
                ? `⏱️ AI Paused for ${timeoutMins} mins (Human agent replied). ${remainingMins}m left`
                : `🔒 AI Paused manually by Human agent (Manual Resume required)`);
          await customer.save();
          if (io) io.to(tenantId).emit('customer-updated', customer);
          continue;
        }

        // 💬 Live 1-on-1 Customer Replies: UNLIMITED & UNBLOCKED (Warmup daily limit applies ONLY to Cold Campaigns)
        const { recordOutboundMessage } = require('../accountWarmupService');

        // --- ACCURATE BUSINESS HOURS CHECK (Hours + Minutes + Overnight Support) ---
        const now = new Date();
        const currentTotalMins = (now.getHours() * 60) + now.getMinutes();
        let isOutOfHours = false;
        const outOfHoursAction = tenant?.businessHours?.outOfHoursAction || 'ai_natural';
        
        if (tenant && tenant.businessHours) {
          const [sH, sM] = (tenant.businessHours.start || '09:00').split(':').map(Number);
          const [eH, eM] = (tenant.businessHours.end || '18:00').split(':').map(Number);
          const startTotalMins = (sH * 60) + (sM || 0);
          const endTotalMins = (eH * 60) + (eM || 0);

          if (startTotalMins < endTotalMins) {
            // Normal Day Shift (e.g., 09:30 AM to 06:30 PM)
            if (currentTotalMins < startTotalMins || currentTotalMins >= endTotalMins) {
              isOutOfHours = true;
            }
          } else if (startTotalMins > endTotalMins) {
            // Overnight Shift (e.g., 10:00 PM to 06:00 AM)
            if (currentTotalMins < startTotalMins && currentTotalMins >= endTotalMins) {
              isOutOfHours = true;
            }
          }
        }

        if (isOutOfHours && outOfHoursAction === 'silent') {
          console.log(`[Tenant ${tenantId}] 🌙 Out of hours (Silent Mode Active). Skipping response to ${remoteJid}`);
          customer.aiStatusState = 'SKIPPED_OUT_OF_HOURS';
          customer.lastResponseReason = '🌙 Out of Business Hours (Silent Mode Active)';
          await customer.save();
          if (io) io.to(tenantId).emit('customer-updated', customer);
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
            
            // 🧠 IQ200 INSTANT HUMAN TYPING PRESENCE: Show WhatsApp typing... IMMEDIATELY on request arrival
            await sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});

            let inputMessage = textContent;
            
            // 🛡️ 2-STEP ANTI-BAN LINK INJECTION ON CUSTOMER REPLY
            if (customer.pendingFollowupLink) {
              inputMessage += ` [SYSTEM NOTE: User responded to campaign! Smoothly and naturally share the website link: ${customer.pendingFollowupLink}]`;
            }

            // 💡 QUOTED REPLY HIERARCHY INJECTION FOR AI REASONING
            if (mediaOpts && mediaOpts.quotedContent) {
              inputMessage = `[USER IS SPECIFICALLY REPLYING TO THIS MESSAGE: "${mediaOpts.quotedContent}"] -> USER SAYS: "${textContent}"`;
              console.log(`[Queue AI Prompt Context] Injected Quoted Reply Context: "${mediaOpts.quotedContent}"`);
            }

            if (isOutOfHours && outOfHoursAction === 'ai_natural') {
              inputMessage += ` [SYSTEM NOTE: It is currently outside business hours (closed). Respond naturally as a human assistant taking a note for the owner who will return tomorrow morning.]`;
            }
            
            const aiCallStartTime = Date.now();
            aiReply = await generateAIResponse(tenantId, customer._id, inputMessage);
            const aiElapsedTimeMs = Date.now() - aiCallStartTime;
            console.log(`[IQ200 Engine] AI Generation took ${aiElapsedTimeMs}ms.`);

            // Clear pendingFollowupLink now that AI processed it
            if (customer.pendingFollowupLink) {
              customer.pendingFollowupLink = '';
              await customer.save();
            }

            // 🧠 IQ200 ADAPTIVE DYNAMIC DELAY BALANCER:
            // Target realistic human typing time based on message length (e.g. 1500ms to 3500ms)
            // Subtract time already spent in AI generation so reply feels perfectly timed!
            const targetHumanTypingMs = Math.max(1200, Math.min((aiReply || '').length * 25, 3500));
            const remainingDelayMs = Math.max(300, targetHumanTypingMs - aiElapsedTimeMs);

            if (remainingDelayMs > 0) {
              console.log(`[IQ200 Engine] Balancing delay: Waiting remaining ${remainingDelayMs}ms of target ${targetHumanTypingMs}ms...`);
              await randomDelay(remainingDelayMs, remainingDelayMs + 150);
            }
          }
        }
        
        if (!aiReply) {
          // If AI failed or returned null (e.g. Rate limit or DB error), reset typing status
          await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
          if (io) io.to(tenantId).emit('bot-typing', { customerId: customer._id, isTyping: false });
        } else {
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
              
              // 💬 Per-Chunk Dynamic Typing Indicator based on Word Count & Char Length
              await sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
              if (io) io.to(tenantId).emit('bot-typing', { customerId: customer._id, isTyping: true });

              // Calculate typing duration dynamically based on words & length:
              // Average human typing speed = 40-50 WPM (~220ms per word + ~30ms per char)
              const wordCount = chunk.split(/\s+/).filter(Boolean).length;
              const charCount = chunk.length;
              
              const rawTypingMs = Math.round((wordCount * 250) + (charCount * 35));
              const randomFactor = 0.90 + (Math.random() * 0.25); // 0.90 to 1.15 multiplier
              const chunkTypingMs = Math.max(1200, Math.min(Math.round(rawTypingMs * randomFactor), 8000));
              
              console.log(`[Dynamic Typing Simulator] Chunk ${i+1}/${chunks.length} | Words: ${wordCount} | Chars: ${charCount} | Live Typing Status: ${chunkTypingMs}ms`);
              
              // Keep sending presence update every 2.5s if typing takes longer (WhatsApp presence expires after 3-5s)
              const typingInterval = setInterval(() => {
                sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
              }, 2500);

              await randomDelay(chunkTypingMs, chunkTypingMs + 100);
              clearInterval(typingInterval);

              // Pause typing right before sending
              await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
              if (io) io.to(tenantId).emit('bot-typing', { customerId: customer._id, isTyping: false });

              const sentMsg = await sock.sendMessage(remoteJid, { text: chunk });

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
              
              // Dynamic Inter-Message Gap: Gap depends on length of NEXT message (thinking/composing time)
              if (i < chunks.length - 1) {
                const nextChunk = chunks[i + 1];
                const nextWordCount = nextChunk.split(/\s+/).filter(Boolean).length;
                // Gap = base 800ms + 150ms per word in next chunk (e.g. 10 words next => ~2.3 sec gap)
                const dynamicGapMs = Math.max(800, Math.min(800 + (nextWordCount * 150) + Math.floor(Math.random() * 400), 4000));
                console.log(`[Dynamic Inter-Message Gap] Waiting ${dynamicGapMs}ms before typing chunk ${i+2}...`);
                await randomDelay(dynamicGapMs, dynamicGapMs + 100);
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
                
                const audioSource = voiceData.cloudUrl || voiceData.filePath;
                const mime = 'audio/ogg; codecs=opus';

                const sentAudio = await sock.sendMessage(remoteJid, {
                  audio: { url: audioSource },
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
