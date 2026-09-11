const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { handleIncomingMessages } = require('./messageHandler');

// Maintain active sessions per tenant
const activeSessions = new Map();

async function startWhatsAppSession(tenantId, io) {
  try {
    // Terminate pre-existing active socket for the same tenant to avoid duplicate active sockets
    const existingSock = activeSessions.get(tenantId);
    if (existingSock) {
      try {
        existingSock.ev?.removeAllListeners('connection.update');
        existingSock.ev?.removeAllListeners();
        if (typeof existingSock.end === 'function') {
          existingSock.end(new Error('Replacing existing connection'));
        }
      } catch (e) {
        /* ignore cleanup error */
      }
      activeSessions.delete(tenantId);
    }

    const authPath = path.join(__dirname, `../../auth_info_baileys/${tenantId}`);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    // Fetch latest WhatsApp Web version to prevent 405 Protocol Rejection
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    const sock = makeWASocket({
      version,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '120.0.0.0'],
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      console.log(`[Baileys UPDATE - Tenant ${tenantId}] Connection State: ${connection || 'PENDING'}, QR Generated: ${!!qr}`);

      if (qr) {
        const qrCodeDataUrl = await qrcode.toDataURL(qr);
        console.log(`[Tenant ${tenantId}] QR Code newly generated. Waiting for scan...`);
        io.to(tenantId).emit('qr-code', { tenantId, qr: qrCodeDataUrl });
        io.to(tenantId).emit('qr', { qrCode: qrCodeDataUrl });
        io.to(tenantId).emit('console-log', `QR Code Generated at ${new Date().toLocaleTimeString()}`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        
        console.error(`[Tenant ${tenantId}] Connection closed! Reason code: ${statusCode}`);

        // Kill all listeners on current socket FIRST to prevent saveCreds writing to deleted dir
        sock.ev?.removeAllListeners();
        activeSessions.delete(tenantId);

        // Handle Code 405 / 440 (Connection Replaced — Baileys v7 uses 440)
        if (statusCode === 405 || statusCode === 440 || statusCode === DisconnectReason.connectionReplaced) {
          console.error(`[Tenant ${tenantId}] Connection replaced (Code ${statusCode}). Cleaning session & regenerating QR...`);
          try {
            if (fs.existsSync(authPath)) {
              fs.rmSync(authPath, { recursive: true, force: true });
            }
            // Recreate empty dir so useMultiFileAuthState doesn't crash
            fs.mkdirSync(authPath, { recursive: true });
          } catch (fsErr) {
            console.error(`[Tenant ${tenantId}] Error cleaning auth dir:`, fsErr);
          }
          io.to(tenantId).emit('connection-status', { status: 'disconnected', reason: 'replaced' });
          io.to(tenantId).emit('console-log', 'Session cleaned. Generating fresh QR code...');
          
          setTimeout(() => {
            startWhatsAppSession(tenantId, io);
          }, 2000);
          return;
        }

        // Handle Code 401 (Logged Out / Corrupted Credentials)
        if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
          console.error(`[Tenant ${tenantId}] Logged out (Code 401). Deleting auth directory...`);
          try {
            if (fs.existsSync(authPath)) {
              fs.rmSync(authPath, { recursive: true, force: true });
            }
            fs.mkdirSync(authPath, { recursive: true });
          } catch (fsErr) {
            console.error(`[Tenant ${tenantId}] Error deleting auth dir:`, fsErr);
          }
          io.to(tenantId).emit('connection-status', { status: 'logged_out' });
          io.to(tenantId).emit('console-log', 'Session permanently logged out. Directory cleaned. Please scan new QR.');
          return;
        }

        // Handle Standard Network Disconnects (Reconnect with 3s Delay)
        console.log(`[Tenant ${tenantId}] Attempting automatic reconnect in 3s...`);
        io.to(tenantId).emit('connection-status', { status: 'reconnecting', reason: statusCode });
        setTimeout(() => {
          startWhatsAppSession(tenantId, io);
        }, 3000);
      } else if (connection === 'connecting') {
        console.log(`[Tenant ${tenantId}] WhatsApp is currently connecting (Syncing chats/keys)...`);
        io.to(tenantId).emit('connection-status', { status: 'connecting' });
        io.to(tenantId).emit('console-log', 'WhatsApp is syncing keys. Please wait...');
      } else if (connection === 'open') {
        console.log(`[Tenant ${tenantId}] 🔥 WhatsApp Connected Successfully!`);
        io.to(tenantId).emit('connection-status', { status: 'connected' });
        io.to(tenantId).emit('whatsapp-status', { status: 'connected' });
        io.to(tenantId).emit('console-log', 'WhatsApp Connected Successfully & Ready for Action!');

        // Auto-start any running campaigns for this tenant
        try {
          const campaignManager = require('./campaignManager');
          campaignManager.startCampaignProcessor(tenantId);
        } catch (cErr) {
          console.error('[ConnectionManager] Failed to start campaign processor:', cErr.message);
        }
      }
    });

    // Handle Presence Updates (Online/Typing indicators)
    sock.ev.on('presence.update', async (update) => {
      if (!update || !update.id) return;
      const remoteJid = update.id;
      const presenceState = update.presences && update.presences[remoteJid] 
        ? update.presences[remoteJid].lastKnownPresence 
        : null;
        
      if (presenceState) {
        // Emit to frontend: 'available', 'unavailable', 'composing', 'paused'
        io.to(tenantId).emit('contact-presence', { 
          whatsappNumber: remoteJid, 
          presence: presenceState 
        });

        // DEVIL MODE: Log Activity (Stalker Mode)
        if (presenceState === 'available' || presenceState === 'composing') {
          const Customer = require('../../models/Customer');
          const ActivityLog = require('../../models/ActivityLog');
          try {
            const cust = await Customer.findOne({ tenantId, whatsappNumber: remoteJid });
            if (cust) {
              cust.lastActiveAt = new Date();
              await cust.save();
              
              await ActivityLog.create({
                tenantId,
                customerId: cust._id,
                actionType: `presence_${presenceState}`
              });
            }
          } catch (err) {
            console.error('Error logging presence activity:', err);
          }
        }
      }
    });

    const syncContacts = async (contacts, activeChatJids = new Set()) => {
      try {
        const Customer = require('../../models/Customer');
        const { mergeLidIntoPhoneCustomer, cleanupDuplicateLidCustomers } = require('./contactMerger');
        console.log(`[Tenant ${tenantId}] Syncing ${contacts.length} contacts from WhatsApp...`);
        
        for (const contact of contacts) {
          if (!contact.id || contact.id.endsWith('@g.us') || contact.id.includes('@newsletter') || contact.id.includes('@broadcast')) {
            continue; // Skip groups, channels, and broadcasts
          }
          
          // Only save if it's a saved contact OR it's an active chat
          const isSaved = !!contact.name;
          const isActiveChat = activeChatJids.has(contact.id);
          
          if (!isSaved && !isActiveChat) continue; 
          
          let rawName = contact.name || contact.verifiedName || contact.notify || '';
          const isLid = contact.id.includes('@lid');

          // If rawName is missing or is just numeric LID digits > 13 chars
          let savedName = rawName;
          if (!savedName || (/^\d+$/.test(savedName) && savedName.length > 13)) {
            savedName = isLid ? 'WhatsApp User (Private ID)' : `+${contact.id.split('@')[0]}`;
          }

          // If contact object contains LID mapping from Baileys
          if (contact.id && contact.lid) {
            await mergeLidIntoPhoneCustomer(tenantId, contact.id, contact.lid, savedName);
            continue;
          }
          
          try {
            let customer = await Customer.findOne({ 
              tenantId, 
              $or: [{ whatsappNumber: contact.id }, { aliasIds: contact.id }] 
            });
            
            if (!customer) {
              await Customer.create({
                tenantId,
                whatsappNumber: contact.id,
                name: savedName
              });
            } else if (contact.name && customer.name !== contact.name) {
              customer.name = contact.name;
              await customer.save();
            }
          } catch (err) {
            if (err.code === 11000) {
              console.log(`[Tenant ${tenantId}] Contact ${contact.id} already exists (Handled duplicate key).`);
            } else {
              console.error(`[Tenant ${tenantId}] Error saving contact ${contact.id}:`, err.message);
            }
          }
        }

        // Run auto-merger pass to clean up any pre-existing duplicate LID objects
        await cleanupDuplicateLidCustomers(tenantId);

      } catch (err) {
        console.error(`[Tenant ${tenantId}] Error syncing contacts:`, err);
      }
    };

    sock.ev.on('contacts.upsert', (contacts) => syncContacts(contacts));

    sock.ev.on('messaging-history.set', async ({ contacts, chats }) => {
      if (contacts && contacts.length > 0) {
        console.log(`[Tenant ${tenantId}] messaging-history.set triggered. Found ${contacts.length} contacts, ${chats?.length || 0} chats.`);
        
        const activeChatJids = new Set();
        if (chats) {
          chats.forEach(chat => activeChatJids.add(chat.id));
        }
        
        await syncContacts(contacts, activeChatJids);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        await handleIncomingMessages(messages, tenantId, sock, io);
      }
    });

    sock.ev.on('presence.update', async (presenceUpdate) => {
      const { id, presences } = presenceUpdate; // id is the jid of the user
      // presences contains info like { 'participant-jid': { lastKnownPresence: 'composing' } }
      // the key in presences is usually the participant or device.
      if (!id || !presences) return;

      // Extract the first value
      const presenceKeys = Object.keys(presences);
      if (presenceKeys.length === 0) return;
      
      const presenceData = presences[presenceKeys[0]];
      const status = presenceData.lastKnownPresence;
      
      // Emit to dashboard
      // status can be 'available', 'unavailable', 'composing', 'paused'
      let isOnline = (status === 'available' || status === 'composing');
      let isTyping = (status === 'composing');
      
      if (io) {
        io.to(tenantId).emit('presence-update', { 
          whatsappNumber: id, 
          isOnline, 
          isTyping,
          lastSeen: status === 'unavailable' ? Date.now() : null
        });
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      const Message = require('../../models/Message');
      
      for (const item of updates) {
        if (item.update.status) {
          // Status enum mapping
          // 2: SERVER_ACK (sent)
          // 3: DELIVERY_ACK (delivered)
          // 4: READ (read)
          
          let statusText = 'sent';
          if (item.update.status === 3) statusText = 'delivered';
          if (item.update.status === 4) statusText = 'read';

          try {
            const dbMsg = await Message.findOneAndUpdate(
              { messageId: item.key.id },
              { status: statusText },
              { returnDocument: 'after' }
            );

            if (dbMsg && io) {
              io.to(tenantId).emit('message-status-update', {
                messageId: item.key.id,
                status: statusText,
                customerId: dbMsg.customerId
              });
            }
          } catch (err) {
            console.error(`[Tenant ${tenantId}] Error updating message status:`, err);
          }
        }
      }
    });

    activeSessions.set(tenantId, sock);
    return sock;
  } catch (error) {
    console.error(`[Tenant ${tenantId}] Failed to start session:`, error);
  }
}

function getActiveSession(tenantId) {
  return activeSessions.get(tenantId);
}

function setConnectingState(tenantId) {
  activeSessions.set(tenantId, { status: 'connecting' });
}

function hasActiveSession(tenantId) {
  return activeSessions.has(tenantId);
}

module.exports = {
  startWhatsAppSession,
  getActiveSession,
  setConnectingState,
  hasActiveSession
};
