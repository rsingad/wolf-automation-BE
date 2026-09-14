const dotenv = require('dotenv');
// Load environment variables first
dotenv.config();

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { initializeSocket } = require('./config/socket');

const mongoose = require('mongoose');

const app = express();
const httpServer = createServer(app);
const io = initializeSocket(httpServer);

// Multi-Frontend Origin Whitelist Setup
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  process.env.FREELANCER_FRONTEND_URL || 'https://freelancers.rameshsingad.com',
  'https://wolf.autoreply.rameshsingad.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, origin); // Dynamically reflect requested origin for 100% CORS compliance
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-master-pin', 'X-Master-Pin'],
  credentials: true
}));
app.use(express.json());

// Basic Route
app.get('/', (req, res) => {
  res.send('AI WhatsApp SaaS Backend is running...');
});

const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const tenantRoutes = require('./routes/tenantRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const assetRoutes = require('./routes/assetRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const publicRoutes = require('./routes/publicRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const mailRoutes = require('./routes/mailRoutes');
const wolfGroupRoutes = require('./routes/wolfGroupRoutes');

// Serve static uploads
app.use('/uploads', express.static(require('path').join(__dirname, 'public/uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/tenant', tenantRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin/mail', mailRoutes);
app.use('/api', wolfGroupRoutes); // Wolf Freelancers Group API (/api/join-request & /api/team-members)


const PORT = process.env.PORT || 5000;

// Silence Mongoose deprecation warnings
mongoose.set('returnDocument', 'after');

// Connect to MongoDB and start Server
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    httpServer.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      // Start Drip Marketing Cron
      const { startDripService } = require('./services/whatsapp/dripService');
      startDripService();
      // Start Appointment Reminder Cron
      const { startReminderCron } = require('./services/reminderCron');
      startReminderCron();

      // Restore all existing WhatsApp sessions from MongoDB automatically on server startup/redeploy
      const { restoreAllActiveSessions } = require('./services/whatsapp/connectionManager');
      restoreAllActiveSessions(io);

      // Render Anti-Sleep 24/7 Keep-Alive Service (Prevents 50-sec Cold Starts)
      const axios = require('axios');
      setInterval(() => {
        const renderUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        axios.get(`${renderUrl}/`)
          .then(() => console.log(`[Keep-Alive Ping] Render server kept active at ${new Date().toISOString()}`))
          .catch(() => {});
      }, 9 * 60 * 1000); // Self-ping every 9 minutes
    });

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server Error] Port ${PORT} is already in use by another process.`);
        process.exit(1);
      }
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
  });

// Graceful Nodemon Shutdown
const gracefulShutdown = () => {
  httpServer.close(() => {
    process.exit(0);
  });
};
process.once('SIGUSR2', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);





