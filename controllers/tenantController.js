const Tenant = require('../models/Tenant');
const Payment = require('../models/Payment');

// Get Tenant Settings
exports.getSettings = async (req, res) => {
  try {
    const { tenantId } = req.params;
    let tenant = null;

    if (tenantId && tenantId !== 'undefined') {
      try {
        tenant = await Tenant.findById(tenantId);
      } catch (e) {
        tenant = null;
      }
    }

    if (!tenant) {
      tenant = await Tenant.findOne();
    }

    if (!tenant) {
      tenant = await Tenant.create({
        name: 'Default Business',
        email: 'admin@business.com',
        password: 'password123'
      });
    }

    res.status(200).json({ success: true, settings: {
      botPrompt: tenant.botPrompt,
      knowledgeBaseText: tenant.knowledgeBaseText,
      businessHours: tenant.businessHours || { start: "09:00", end: "18:00", outOfHoursMessage: "We are currently closed.", outOfHoursAction: "ai_natural" },
      ghostMode: tenant.ghostMode || false,
      aiVoiceEnabled: tenant.aiVoiceEnabled || false,
      aiVoiceMode: tenant.aiVoiceMode || 'both',
      aiVoiceGender: tenant.aiVoiceGender || 'female',
      aiVoiceActor: tenant.aiVoiceActor || 'hi-IN-SwaraNeural',
      aiVoiceSpeed: tenant.aiVoiceSpeed || '+0%',
      aiVoiceLanguage: tenant.aiVoiceLanguage || 'hi',
      bookingEnabled: tenant.bookingEnabled !== undefined ? tenant.bookingEnabled : true,
      bookingSlotDuration: tenant.bookingSlotDuration || 30,
      autoConfirmBooking: tenant.autoConfirmBooking !== undefined ? tenant.autoConfirmBooking : true,
      servicesList: tenant.servicesList || ["General Consultation", "Service Inquiry", "Booking / Reservation"],
      webSearchEnabled: tenant.webSearchEnabled !== undefined ? tenant.webSearchEnabled : true,
      businessWebsiteUrl: tenant.businessWebsiteUrl || "",
      aiAutoReplyDisabled: tenant.aiAutoReplyDisabled || false,
      humanTakeoverResumeMinutes: tenant.humanTakeoverResumeMinutes !== undefined ? tenant.humanTakeoverResumeMinutes : 30
    }});
  } catch (error) {
    console.error('Error fetching tenant settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Update Tenant Settings
exports.updateSettings = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const updateData = req.body;
    let tenant = null;

    // Find old tenant settings to check if prompt/RAG actually changed
    const existingTenant = await Tenant.findById(tenantId);

    // 📜 Prompt & Knowledge Base History Tracking Logic
    const PromptHistory = require('../models/PromptHistory');

    if (updateData.botPrompt && updateData.botPrompt.trim()) {
      const oldPrompt = existingTenant ? (existingTenant.botPrompt || '').trim() : '';
      if (updateData.botPrompt.trim() !== oldPrompt) {
        await PromptHistory.create({
          tenantId: tenantId,
          type: 'botPrompt',
          title: `Bot Prompt Version (${new Date().toLocaleString('en-IN')})`,
          content: updateData.botPrompt,
          charCount: updateData.botPrompt.length,
          isActive: true
        });
        console.log(`[Prompt History] 📜 Saved new Global Prompt version for tenant ${tenantId}`);
      }
    }

    if (updateData.knowledgeBaseText && updateData.knowledgeBaseText.trim()) {
      const oldRAG = existingTenant ? (existingTenant.knowledgeBaseText || '').trim() : '';
      if (updateData.knowledgeBaseText.trim() !== oldRAG) {
        await PromptHistory.create({
          tenantId: tenantId,
          type: 'knowledgeBaseText',
          title: `RAG Vault Version (${new Date().toLocaleString('en-IN')})`,
          content: updateData.knowledgeBaseText,
          charCount: updateData.knowledgeBaseText.length,
          isActive: true
        });
        console.log(`[Prompt History] 📜 Saved new RAG Vault version for tenant ${tenantId}`);
      }
    }

    if (tenantId && tenantId !== 'undefined') {
      try {
        tenant = await Tenant.findByIdAndUpdate(tenantId, updateData, { returnDocument: 'after' });
      } catch (e) {
        tenant = null;
      }
    }

    if (tenant && updateData.aiAutoReplyDisabled !== undefined) {
      const Customer = require('../models/Customer');
      await Customer.updateMany(
        { tenantId: tenant._id },
        { $set: { aiPaused: updateData.aiAutoReplyDisabled } }
      );

      try {
        const { getIo } = require('../config/socket');
        const io = getIo();
        if (io) {
          io.to(tenant._id.toString()).emit('global_ai_toggled', {
            aiAutoReplyDisabled: tenant.aiAutoReplyDisabled
          });
        }
      } catch (e) {}
    }

    res.status(200).json({ success: true, settings: {
      botPrompt: tenant.botPrompt,
      knowledgeBaseText: tenant.knowledgeBaseText,
      businessHours: tenant.businessHours,
      ghostMode: tenant.ghostMode,
      aiVoiceEnabled: tenant.aiVoiceEnabled,
      aiVoiceMode: tenant.aiVoiceMode,
      aiVoiceGender: tenant.aiVoiceGender,
      aiVoiceActor: tenant.aiVoiceActor,
      aiVoiceSpeed: tenant.aiVoiceSpeed,
      aiVoiceLanguage: tenant.aiVoiceLanguage,
      bookingEnabled: tenant.bookingEnabled,
      bookingSlotDuration: tenant.bookingSlotDuration,
      autoConfirmBooking: tenant.autoConfirmBooking,
      servicesList: tenant.servicesList,
      webSearchEnabled: tenant.webSearchEnabled,
      businessWebsiteUrl: tenant.businessWebsiteUrl,
      aiAutoReplyDisabled: tenant.aiAutoReplyDisabled
    }});
  } catch (error) {
    console.error('Error updating tenant settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// 📜 Get Prompt & Knowledge Base History Logs
exports.getPromptHistory = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { type } = req.query; // 'botPrompt' | 'knowledgeBaseText'

    const PromptHistory = require('../models/PromptHistory');
    let query = {};
    if (tenantId && tenantId !== 'undefined' && tenantId !== 'null') {
      query.tenantId = tenantId;
    }
    if (type) query.type = type;

    let history = await PromptHistory.find(query).sort({ createdAt: -1 }).limit(50);
    
    // Fallback if tenantId had different ObjectId format
    if (history.length === 0 && type) {
      history = await PromptHistory.find({ type }).sort({ createdAt: -1 }).limit(50);
    }

    res.status(200).json({ success: true, history });
  } catch (error) {
    console.error('Error fetching prompt history:', error);
    res.status(500).json({ error: 'Failed to fetch prompt history' });
  }
};

// 📜 Delete Prompt History Item
exports.deletePromptHistoryItem = async (req, res) => {
  try {
    const { historyId } = req.params;
    const PromptHistory = require('../models/PromptHistory');
    await PromptHistory.findByIdAndDelete(historyId);
    res.status(200).json({ success: true, message: 'History record deleted' });
  } catch (error) {
    console.error('Error deleting prompt history item:', error);
    res.status(500).json({ error: 'Failed to delete history item' });
  }
};

// Top-Up Wolf Coins
exports.topupCoins = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { coinsToAdd, amountPaidInr, packageName, utrNumber } = req.body;

    if (!coinsToAdd || typeof coinsToAdd !== 'number' || coinsToAdd <= 0) {
      return res.status(400).json({ error: 'Valid coin amount is required' });
    }

    let tenant = null;
    if (tenantId && tenantId !== 'undefined') {
      try {
        tenant = await Tenant.findById(tenantId);
      } catch (e) {}
    }

    if (!tenant) {
      tenant = await Tenant.findOne();
    }

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Create Pending Payment Claim for Admin Verification
    let paymentRecord = await Payment.create({
      tenantId: tenant._id,
      packageName: packageName || 'Growth Pack',
      coinsAllocated: coinsToAdd,
      amountPaidInr: amountPaidInr || 0,
      utrNumber: utrNumber || `UTR-${Date.now()}`,
      paymentMethod: 'UPI Scanner Gateway',
      status: 'pending'
    });

    // Broadcast analytics & payment update socket events
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('analytics_updated', { tenantId: tenant._id });
        io.emit('payment_created', { tenantId: tenant._id, payment: paymentRecord });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      pending: true,
      message: `⏳ Payment submission received (UTR: ${utrNumber})! Coins will be credited once verified by Admin.`,
      paymentRecord
    });
  } catch (error) {
    console.error('Error topping up coins:', error);
    res.status(500).json({ error: 'Failed to process coin purchase' });
  }
};

// Test Neural Voice Sample Generation
exports.testVoiceSample = async (req, res) => {
  try {
    const { text, voiceActor, voiceSpeed } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text content is required for voice sample test' });
    }

    const { generateVoiceNote } = require('../services/ttsService');
    const voiceData = await generateVoiceNote(text, 'hi', 'female', voiceActor || 'hi-IN-SwaraNeural', voiceSpeed || '+0%');

    if (!voiceData || !voiceData.publicUrl) {
      return res.status(500).json({ error: 'Failed to generate neural voice sample' });
    }

    res.status(200).json({
      success: true,
      publicUrl: voiceData.publicUrl,
      filename: voiceData.filename
    });
  } catch (error) {
    console.error('Error generating test voice sample:', error);
    res.status(500).json({ error: 'Voice sample generation failed' });
  }
};

// Get WhatsApp Account Health & Warm-Up Status (Level 1-4)
exports.getWarmupStatus = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { getTenantWarmupStatus } = require('../services/accountWarmupService');
    const warmup = await getTenantWarmupStatus(tenantId);
    res.status(200).json({ success: true, warmup });
  } catch (error) {
    console.error('Error getting warmup status:', error);
    res.status(500).json({ error: 'Failed to fetch warmup status' });
  }
};

// Reward Wolf Coins (3D Game Mining Rewards)
exports.rewardCoins = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { coinsEarned, gameMode } = req.body;

    if (!coinsEarned || typeof coinsEarned !== 'number' || coinsEarned <= 0) {
      return res.status(400).json({ error: 'Valid coin reward amount is required' });
    }

    let tenant = null;
    if (tenantId && tenantId !== 'undefined') {
      try {
        tenant = await Tenant.findById(tenantId);
      } catch (e) {}
    }

    if (!tenant) {
      tenant = await Tenant.findOne();
    }

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Cap reward per game session to 5,000 WOLF Coins for anti-cheat safety
    const safeCoins = Math.min(5000, Math.round(coinsEarned));
    
    // Create a Pending Payment/Reward Claim for Master Owner Approval
    const paymentRecord = await Payment.create({
      tenantId: tenant._id,
      packageName: `3D Arcade Reward (${gameMode || 'Tap Rush'})`,
      coinsAllocated: safeCoins,
      amountPaidInr: 0,
      utrNumber: `GAME-REWARD-${Date.now()}`,
      paymentMethod: '3D Arcade Game Reward',
      status: 'pending'
    });

    // Broadcast socket event for Master Panel approval queue
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('analytics_updated', { tenantId: tenant._id });
        io.emit('payment_created', { tenantId: tenant._id, payment: paymentRecord });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      pending: true,
      rewardedAmount: safeCoins,
      message: `⏳ Arcade reward of +${safeCoins.toLocaleString('en-IN')} Wolf Coins submitted! It will be credited once verified by Master Admin in Control Panel.`
    });
  } catch (error) {
    console.error('Error rewarding coins:', error);
    res.status(500).json({ error: 'Failed to submit game reward claim' });
  }
};

// Wolf Master Command Center: Get All Organizations & Global Metrics
exports.getAllOrganizationsAdmin = async (req, res) => {
  try {
    const masterPin = req.headers['x-master-pin'] || req.query.pin;
    const masterPinEnv = process.env.WOLF_MASTER_PIN;

    if (!masterPinEnv || !masterPin || masterPin !== masterPinEnv) {
      return res.status(403).json({ error: '🔒 Access Denied: Invalid Super Owner Master PIN' });
    }

    const Customer = require('../models/Customer');
    const Message = require('../models/Message');
    const Campaign = require('../models/Campaign');
    const Payment = require('../models/Payment');

    const tenants = await Tenant.find().sort({ createdAt: -1 });

    const orgList = await Promise.all(
      tenants.map(async (t) => {
        const totalCustomers = await Customer.countDocuments({ tenantId: t._id });
        const totalSent = await Message.countDocuments({ tenantId: t._id, sender: { $in: ['bot', 'agent'] } });
        const totalReceived = await Message.countDocuments({ tenantId: t._id, sender: 'customer' });
        const totalCampaigns = await Campaign.countDocuments({ tenantId: t._id });
        const payments = await Payment.find({ tenantId: t._id, status: 'approved' });
        const totalSpentInr = payments.reduce((sum, p) => sum + (p.amountPaidInr || 0), 0);

        return {
          id: t._id,
          name: t.name,
          email: t.email,
          whatsappNumber: t.whatsappNumber || 'Not Connected',
          status: t.status || (t.isApproved === false ? 'pending_approval' : 'active'),
          isApproved: t.isApproved !== false,
          isFrozen: t.isFrozen || false,
          freezeReason: t.freezeReason || '',
          accountLevel: t.accountLevel || 1,
          logRetentionDays: t.logRetentionDays || 90,
          wolfCoins: t.wolfCoins || 500000,
          totalCustomers,
          messagesSent: totalSent,
          messagesReceived: totalReceived,
          totalMessages: totalSent + totalReceived,
          totalCampaigns,
          totalSpentInr,
          createdAt: t.createdAt
        };
      })
    );

    // System-wide Aggregated Totals
    const totalOrgs = orgList.length;
    const globalMessages = orgList.reduce((sum, o) => sum + o.totalMessages, 0);
    const globalCustomers = orgList.reduce((sum, o) => sum + o.totalCustomers, 0);
    const globalRevenueInr = orgList.reduce((sum, o) => sum + o.totalSpentInr, 0);

    res.status(200).json({
      success: true,
      summary: {
        totalOrgs,
        globalMessages,
        globalCustomers,
        globalRevenueInr
      },
      organizations: orgList
    });
  } catch (error) {
    console.error('Error fetching admin organizations:', error);
    res.status(500).json({ error: 'Failed to fetch organizations list' });
  }
};

// Wolf Master Command Center: Manual Coin Credit / Debit Grant to Any Org
exports.manualCoinGrantAdmin = async (req, res) => {
  try {
    const { targetTenantId, coinsAmount, note } = req.body;

    if (!targetTenantId || !coinsAmount || typeof coinsAmount !== 'number') {
      return res.status(400).json({ error: 'Target tenant ID and valid coin amount required' });
    }

    const tenant = await Tenant.findById(targetTenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    tenant.wolfCoins = Math.max(0, (tenant.wolfCoins || 500000) + coinsAmount);
    if (coinsAmount > 0) {
      tenant.totalWolfTokensAllocated = (tenant.totalWolfTokensAllocated || 500000) + coinsAmount;
    }
    await tenant.save();

    // Broadcast socket event
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('analytics_updated', { tenantId: tenant._id });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      newBalance: tenant.wolfCoins,
      message: `🎉 Successfully updated ${tenant.name}'s balance to ${tenant.wolfCoins.toLocaleString('en-IN')} Wolf Coins!`
    });
  } catch (error) {
    console.error('Error granting coins to org:', error);
    res.status(500).json({ error: 'Failed to grant coins' });
  }
};

// Wolf Master Command Center: Toggle Freeze / Unfreeze Client Account
exports.toggleFreezeTenantAdmin = async (req, res) => {
  try {
    const { targetTenantId, freezeReason } = req.body;

    if (!targetTenantId) {
      return res.status(400).json({ error: 'Target tenant ID is required' });
    }

    const tenant = await Tenant.findById(targetTenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const newFreezeStatus = !tenant.isFrozen;
    tenant.isFrozen = newFreezeStatus;
    tenant.freezeReason = newFreezeStatus ? (freezeReason || 'Free Demo Period Expired. Please top up your account.') : '';
    tenant.freezeDate = newFreezeStatus ? new Date() : null;

    await tenant.save();

    // Broadcast socket event
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('tenant_frozen_toggled', { 
          tenantId: tenant._id,
          isFrozen: tenant.isFrozen,
          freezeReason: tenant.freezeReason
        });
        io.emit('analytics_updated', { tenantId: tenant._id });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      isFrozen: tenant.isFrozen,
      freezeReason: tenant.freezeReason,
      message: tenant.isFrozen 
        ? `❄️ Account "${tenant.name}" has been FROZEN! AI replies & campaigns stopped.` 
        : `🔥 Account "${tenant.name}" has been UN-FROZEN & restored to active state!`
    });
  } catch (error) {
    console.error('Error toggling tenant freeze state:', error);
    res.status(500).json({ error: 'Failed to update account freeze state' });
  }
};

// Wolf Master Command Center: Update Tenant Account Limit Level (1-4: Warmup, Growth, Pro, Enterprise)
exports.updateAccountLevelAdmin = async (req, res) => {
  try {
    const { targetTenantId, accountLevel } = req.body;

    if (!targetTenantId || !accountLevel || typeof accountLevel !== 'number') {
      return res.status(400).json({ error: 'Target tenant ID and valid level (1-4) required' });
    }

    if (accountLevel < 1 || accountLevel > 4) {
      return res.status(400).json({ error: 'Level must be between 1 (Warmup) and 4 (Enterprise/Unlimited)' });
    }

    const tenant = await Tenant.findById(targetTenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    tenant.accountLevel = accountLevel;
    await tenant.save();

    const levelLabels = {
      1: 'Level 1 (Warmup - 50/day)',
      2: 'Level 2 (Growth - 500/day)',
      3: 'Level 3 (Pro - 2,500/day)',
      4: 'Level 4 (Enterprise - UNLIMITED 🚀)'
    };

    // Broadcast socket update
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('tenant_level_updated', {
          tenantId: tenant._id,
          accountLevel: tenant.accountLevel,
          levelLabel: levelLabels[accountLevel]
        });
        io.emit('analytics_updated', { tenantId: tenant._id });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      accountLevel: tenant.accountLevel,
      message: `🚀 Success! Updated ${tenant.name}'s limit tier to ${levelLabels[accountLevel]}`
    });
  } catch (error) {
    console.error('Error updating tenant level:', error);
    res.status(500).json({ error: 'Failed to update account level' });
  }
};

// Wolf Master Command Center: Approve / Reject Pending Registered Tenant
exports.approveTenantAdmin = async (req, res) => {
  try {
    const { targetTenantId, approve } = req.body; // approve: true | false

    if (!targetTenantId) {
      return res.status(400).json({ error: 'Target tenant ID is required' });
    }

    const tenant = await Tenant.findById(targetTenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    if (approve) {
      tenant.isApproved = true;
      tenant.status = 'active';
    } else {
      tenant.isApproved = false;
      tenant.status = 'inactive';
    }

    await tenant.save();

    // Broadcast socket event
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('tenant_approval_toggled', {
          tenantId: tenant._id,
          isApproved: tenant.isApproved,
          status: tenant.status
        });
        io.emit('analytics_updated', { tenantId: tenant._id });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      isApproved: tenant.isApproved,
      status: tenant.status,
      message: tenant.isApproved 
        ? `✅ Account "${tenant.name}" has been APPROVED! They can now login to Wolf Dashboard.` 
        : `🛑 Account "${tenant.name}" approval status revoked.`
    });
  } catch (error) {
    console.error('Error updating tenant approval state:', error);
// Wolf Master Command Center: Update Log Retention Days (15, 30, 60, 90, 180, 365 days)
exports.updateLogRetentionAdmin = async (req, res) => {
  try {
    const { targetTenantId, logRetentionDays } = req.body;

    if (!targetTenantId || !logRetentionDays || typeof logRetentionDays !== 'number') {
      return res.status(400).json({ error: 'Target tenant ID and valid log retention days required' });
    }

    const tenant = await Tenant.findById(targetTenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    tenant.logRetentionDays = logRetentionDays;
    await tenant.save();

    res.status(200).json({
      success: true,
      logRetentionDays: tenant.logRetentionDays,
      message: `📅 Success! Log retention period updated to ${logRetentionDays} days for "${tenant.name}".`
    });
  } catch (error) {
    console.error('Error updating log retention days:', error);
    res.status(500).json({ error: 'Failed to update log retention days' });
  }
};


