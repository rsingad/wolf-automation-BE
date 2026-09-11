const Tenant = require('../models/Tenant');
const UsageLog = require('../models/UsageLog');
const Message = require('../models/Message');
const Appointment = require('../models/Appointment');
const Customer = require('../models/Customer');

exports.getAnalytics = async (req, res) => {
  try {
    const { tenantId } = req.params;

    const tenantDoc = await Tenant.findById(tenantId).lean();
    const allocatedWolfTokens = (tenantDoc && tenantDoc.wolfCoins > 0) ? tenantDoc.wolfCoins : (tenantDoc && tenantDoc.wolfTokenBalance > 0 ? tenantDoc.wolfTokenBalance : 500000);

    // 1. Fetch Token Usage Logs
    const usageLogs = await UsageLog.find({ tenantId }).sort({ createdAt: -1 });

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    let totalLatencyMs = 0;

    usageLogs.forEach(log => {
      totalPromptTokens += log.promptTokens || 0;
      totalCompletionTokens += log.completionTokens || 0;
      totalTokens += log.totalTokens || 0;
      totalCostUsd += log.estimatedCostUsd || 0;
      totalLatencyMs += log.latencyMs || 0;
    });

    const avgLatencyMs = usageLogs.length > 0 ? Math.round(totalLatencyMs / usageLogs.length) : 0;

    // 2. Total Messages
    const totalMessages = await Message.countDocuments({ tenantId });
    const botMessages = await Message.countDocuments({ tenantId, sender: 'bot' });
    const userMessages = await Message.countDocuments({ tenantId, sender: 'customer' });

    // 3. Audio Voice Notes Sent
    const voiceNotesCount = await Message.countDocuments({ 
      tenantId, 
      sender: 'bot', 
      mediaType: 'audio' 
    });

    // 4. Appointments Booked
    const totalAppointments = await Appointment.countDocuments({ tenantId });
    const confirmedAppointments = await Appointment.countDocuments({ tenantId, status: 'confirmed' });

    // 5. Total Customers / Leads
    const totalCustomers = await Customer.countDocuments({ tenantId });
    const hotLeads = await Customer.countDocuments({ tenantId, aiTag: 'HOT LEAD' });

    const estimatedCostInr = Number((totalCostUsd * 85).toFixed(2));
    const remainingWolfTokens = Math.max(0, allocatedWolfTokens - totalTokens);
    const avgTokensPerMsg = totalMessages > 0 ? Math.max(1, Math.round(totalTokens / totalMessages)) : 200;
    const estimatedMessagesRemaining = Math.floor(remainingWolfTokens / (avgTokensPerMsg || 200));

    res.status(200).json({
      success: true,
      analytics: {
        tokens: {
          totalTokens,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          allocatedWolfTokens,
          remainingWolfTokens,
          estimatedMessagesRemaining,
          avgTokensPerMsg,
          estimatedCostUsd: Number(totalCostUsd.toFixed(4)),
          estimatedCostInr,
          avgLatencyMs
        },
        messages: {
          total: totalMessages,
          bot: botMessages,
          user: userMessages,
          voiceNotes: voiceNotesCount
        },
        appointments: {
          total: totalAppointments,
          confirmed: confirmedAppointments
        },
        customers: {
          total: totalCustomers,
          hotLeads
        },
        recentLogs: usageLogs.slice(0, 10)
      }
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Server error fetching analytics' });
  }
};
