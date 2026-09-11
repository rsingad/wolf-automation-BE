const { Server } = require('socket.io');
const { startWhatsAppSession, hasActiveSession, setConnectingState, getActiveSession } = require('../services/whatsapp/connectionManager');

let ioInstance;

function initializeSocket(httpServer) {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  ioInstance.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);
    
    socket.on('join-tenant', (tenantId) => {
      socket.join(tenantId);
      console.log(`Socket ${socket.id} joined tenant room ${tenantId}`);
  
      if (!hasActiveSession(tenantId)) {
        setConnectingState(tenantId);
        startWhatsAppSession(tenantId, ioInstance);
      } else {
        const sock = getActiveSession(tenantId);
        if (sock && sock.user) {
          ioInstance.to(tenantId).emit('whatsapp-status', { status: 'connected' });
        }
      }
    });
  
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  return ioInstance;
}

function getIo() {
  if (!ioInstance) {
    throw new Error("Socket.io is not initialized!");
  }
  return ioInstance;
}

module.exports = {
  initializeSocket,
  getIo
};
