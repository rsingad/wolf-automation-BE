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
      aiAutoReplyDisabled: tenant.aiAutoReplyDisabled || false
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

    if (tenantId && tenantId !== 'undefined') {
      try {
        tenant = await Tenant.findByIdAndUpdate(tenantId, updateData, { returnDocument: 'after' });
      } catch (e) {
        tenant = null;
      }
    }

    if (!tenant) {
      const existing = await Tenant.findOne();
      if (existing) {
        tenant = await Tenant.findByIdAndUpdate(existing._id, updateData, { returnDocument: 'after' });
      } else {
        tenant = await Tenant.create({
          name: 'Default Business',
          email: 'admin@business.com',
          password: 'password123',
          ...updateData
        });
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
    tenant.wolfCoins = (tenant.wolfCoins || 500000) + safeCoins;
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
      rewardedAmount: safeCoins,
      message: `🎉 Success! +${safeCoins.toLocaleString('en-IN')} Wolf Coins credited from 3D Game!`
    });
  } catch (error) {
    console.error('Error rewarding coins:', error);
    res.status(500).json({ error: 'Failed to credit game coins' });
  }
};
