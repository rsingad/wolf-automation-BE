const { isJidGroup, downloadMediaMessage, getDevice } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const Customer = require('../../models/Customer');
const Message = require('../../models/Message');
const ActivityLog = require('../../models/ActivityLog');
const { addToQueue } = require('./queueManager');
const { transcribeAudio } = require('./transcriptionService');
const { analyzeIntentAndTag } = require('../aiService');

async function handleIncomingMessages(messages, tenantId, sock, io) {
  for (const msg of messages) {
    if (!msg.message) continue;
    
    const remoteJid = msg.key.remoteJid;
    const deviceType = msg.key.id ? getDevice(msg.key.id) : 'unknown';
    
    // 0. Ignore Channels and Broadcasts completely
    if (remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter')) {
      continue;
    }

    const isGroup = isJidGroup(remoteJid);

    // DEVIL MODE: Anti-Delete Feature (Message Revocation)
    const protocolMsg = msg.message.protocolMessage;
    if (protocolMsg && (protocolMsg.type === 0 || protocolMsg.type === 'REVOKE')) {
      const revokedKey = protocolMsg.key;
      if (revokedKey && revokedKey.id) {
        try {
          const updatedMsg = await Message.findOneAndUpdate(
            { messageId: revokedKey.id },
            { deletedBySender: true },
            { returnDocument: 'after' }
          );
          if (updatedMsg && io) {
            io.to(tenantId).emit('message-deleted', { messageId: revokedKey.id });
            console.log(`[Tenant ${tenantId}] Anti-Delete: Captured deleted message from ${remoteJid}`);
          }
        } catch (err) {
          console.error('Error updating revoked message:', err);
        }
      }
      continue; // Skip further processing for this system message
    }

    // DEVIL MODE: Anti-View Once & Media Handling
    const viewOnceMsg = msg.message.viewOnceMessage?.message || 
                        msg.message.viewOnceMessageV2?.message || 
                        msg.message.viewOnceMessageV2Extension?.message;
                        
    const actualMsg = viewOnceMsg || msg.message;
    const isViewOnce = !!viewOnceMsg;
    
    let textContent = actualMsg.conversation || actualMsg.extendedTextMessage?.text || actualMsg.imageMessage?.caption || actualMsg.videoMessage?.caption;
    let mediaUrl = null;
    let mediaType = null;
    
    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Handle Image
    if (actualMsg.imageMessage) {
      try {
        console.log(`[Tenant ${tenantId}] Intercepted Image (ViewOnce: ${isViewOnce})`);
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: console, reuploadRequest: sock.updateMediaMessage });
        const filename = `img_${Date.now()}.jpg`;
        fs.writeFileSync(path.join(uploadsDir, filename), buffer);
        mediaUrl = `/uploads/${filename}`;
        mediaType = 'image';
        if (!textContent) textContent = '📷 Image';
      } catch (err) {
        console.error('Error downloading image:', err);
      }
    }
    // Handle Video
    else if (actualMsg.videoMessage) {
      try {
        console.log(`[Tenant ${tenantId}] Intercepted Video (ViewOnce: ${isViewOnce})`);
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: console, reuploadRequest: sock.updateMediaMessage });
        const filename = `vid_${Date.now()}.mp4`;
        fs.writeFileSync(path.join(uploadsDir, filename), buffer);
        mediaUrl = `/uploads/${filename}`;
        mediaType = 'video';
        if (!textContent) textContent = '🎥 Video';
      } catch (err) {
        console.error('Error downloading video:', err);
      }
    }
    // Handle Audio / Voice Note
    else if (actualMsg.audioMessage) {
      try {
        console.log(`[Tenant ${tenantId}] Received Audio Message. Downloading and Transcribing...`);
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: console, reuploadRequest: sock.updateMediaMessage });
        
        const transcribedText = await transcribeAudio(buffer);
        if (transcribedText) {
          textContent = `🎤 [Voice Note]: ${transcribedText}`;
          console.log(`[Tenant ${tenantId}] Transcription Success: ${textContent}`);
        } else {
          textContent = `🎤 [Voice Note]: (Could not transcribe audio)`;
        }
      } catch (err) {
        console.error(`[Tenant ${tenantId}] Error downloading/transcribing audio:`, err);
        textContent = `🎤 [Voice Note]: (Audio unreadable)`;
      }
    }

    if (!textContent && !mediaUrl) continue;

    // 1. Handle Groups
    // 1. Handle Groups
    if (isGroup) {
      let customer = await Customer.findOne({ tenantId, whatsappNumber: remoteJid });
      if (!customer) {
        let groupSubject = msg.pushName || 'WhatsApp Group';
        let groupMetadata = null;
        try {
          groupMetadata = await sock.groupMetadata(remoteJid);
          if (groupMetadata && groupMetadata.subject) groupSubject = groupMetadata.subject;
        } catch (err) {}
        
        try {
          customer = await Customer.create({
            tenantId,
            whatsappNumber: remoteJid,
            name: groupSubject,
            isGroup: true,
            ...(groupMetadata ? { groupMetadata } : {})
          });
        } catch (err) {
          customer = await Customer.findOne({ tenantId, whatsappNumber: remoteJid });
        }
      }

      const participantJid = msg.key.participant;
      
      // Try to find if participant is in our synced contacts for a real name
      let participantName = '';
      if (participantJid) {
        const pCustomer = await Customer.findOne({ tenantId, whatsappNumber: participantJid });
        if (pCustomer && pCustomer.name && pCustomer.name !== participantJid.split('@')[0]) {
          // If it's a properly saved contact, just show their Name
          participantName = pCustomer.name;
        } else {
          // If unsaved, show Phone Number + WhatsApp Name
          const phonePart = `+${participantJid.split('@')[0]}`;
          participantName = msg.pushName ? `${phonePart} (~${msg.pushName})` : phonePart;
        }
      } else {
        participantName = msg.pushName || 'Unknown';
      }

      const existingMsg = await Message.findOne({ messageId: msg.key.id });
      if (!existingMsg) {
        const incomingMsg = await Message.create({
          tenantId,
          customerId: customer._id,
          sender: msg.key.fromMe ? 'agent' : 'customer',
          content: textContent || '📷 [Media]',
          messageId: msg.key.id,
          participantJid,
          participantName,
          mediaUrl,
          mediaType,
          isViewOnce
        });

        if (io) {
          io.to(tenantId).emit('new-message', { customerId: customer._id, message: incomingMsg });
        }
        
        // Phase 21: SMART INTERCEPTOR - Cancel pending DripJobs if customer replies
        const DripJob = require('../../models/DripJob');
        const cancelledJobs = await DripJob.updateMany(
          { customerId: customer._id, status: 'pending' },
          { status: 'cancelled' }
        );
        if (cancelledJobs.modifiedCount > 0) {
          console.log(`[Smart Interceptor] Cancelled ${cancelledJobs.modifiedCount} pending drip messages for customer ${customer._id} because they replied!`);
        }
      }
      
      // Groups bypass the AI Queue completely
      continue;
    } 

    // 2. Handle our own messages (Sent from Web OR Native Phone)
    if (msg.key.fromMe) {
      // Check if we already saved this message (meaning Bot or Web Dashboard sent it)
      const existingMsg = await Message.findOne({ messageId: msg.key.id });
      if (!existingMsg) {
        // This was sent natively from the physical phone!
        let customer = await Customer.findOne({ 
          tenantId, 
          $or: [{ whatsappNumber: remoteJid }, { aliasIds: remoteJid }]
        });
        
        if (!customer) {
          const isLid = remoteJid.includes('@lid');
          let pushName = msg.pushName;
          if (!pushName || (/^\d+$/.test(pushName) && pushName.length > 13)) {
            pushName = isLid ? 'WhatsApp User (Private ID)' : `+${remoteJid.split('@')[0]}`;
          }

          if (isLid && pushName !== 'WhatsApp User (Private ID)') {
            const matches = await Customer.find({ tenantId, name: pushName });
            if (matches.length === 1) {
              customer = matches[0];
              customer.aliasIds.push(remoteJid);
              await customer.save();
            }
          }
          
          if (!customer) {
            try {
              customer = await Customer.create({ tenantId, whatsappNumber: remoteJid, name: pushName });
            } catch (err) {
              customer = await Customer.findOne({ tenantId, whatsappNumber: remoteJid });
            }
          }
        }

        // Fetch DP and About if missing
        if (!customer.profilePic || !customer.about) {
          let updated = false;
          if (!customer.profilePic) {
            try {
              const dpUrl = await sock.profilePictureUrl(remoteJid, 'image');
              if (dpUrl) {
                customer.profilePic = dpUrl;
                updated = true;
              }
            } catch (err) {}
          }
          if (!customer.about) {
            try {
              const statusData = await sock.fetchStatus(remoteJid);
              if (statusData && statusData.status) {
                customer.about = statusData.status;
                updated = true;
              }
            } catch (err) {}
          }
          if (updated) await customer.save();
        }

        const phoneMsg = await Message.create({
          tenantId,
          customerId: customer._id,
          sender: 'agent',
          content: textContent || '📷 [Media]',
          messageId: msg.key.id,
          mediaUrl,
          mediaType,
          isViewOnce
        });
        // Show it on the dashboard!
        if (io) io.to(tenantId).emit('new-message', { customerId: customer._id, message: phoneMsg });
      }
      // Do NOT trigger AI reply for our own messages
      continue;
    } 

    console.log(`[Tenant ${tenantId}] Queued Message from ${remoteJid}: ${textContent || 'Media'}`);

    // Phase 25: AI Auto-Tagging (Fire and Forget)
    // Find customer to get ID for tagging
    Customer.findOne({ tenantId, $or: [{ whatsappNumber: remoteJid }, { aliasIds: remoteJid }] })
      .then(cust => {
        if (cust) {
          analyzeIntentAndTag(tenantId, cust._id, textContent || 'Media File', io).catch(console.error);
        }
      })
      .catch(console.error);

    // Push to user's queue
    addToQueue(tenantId, remoteJid, textContent || '', msg.key, msg.pushName, sock, io, { mediaUrl, mediaType, isViewOnce, deviceType });
  }
}

module.exports = {
  handleIncomingMessages
};
