const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function testContacts() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys/test');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' })
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('contacts.upsert', (contacts) => {
    console.log('Received contacts:', contacts.length);
    if (contacts.length > 0) {
      console.log('First 2 contacts:', contacts.slice(0, 2));
    }
  });

  sock.ev.on('connection.update', (update) => {
    console.log('Connection update:', update.connection);
  });
}

testContacts();
