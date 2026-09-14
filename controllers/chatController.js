const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Message = require('../models/Message');

// Get all customers for a tenant
exports.getCustomers = async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    // Fetch customers, sorted by most recently updated
    const customers = await Customer.find({ tenantId }).sort({ updatedAt: -1 });
    
    // Attach the last message for each customer to show in the sidebar snippet
    const customersWithLastMessage = await Promise.all(
      customers.map(async (customer) => {
        const lastMessage = await Message.findOne({ customerId: customer._id })
          .sort({ createdAt: -1 });
          
        return {
          ...customer.toObject(),
          lastMessage: lastMessage ? lastMessage.content : 'No messages yet',
          lastMessageAt: lastMessage ? lastMessage.createdAt : customer.updatedAt
        };
      })
    );

    // Sort by lastMessageAt descending
    customersWithLastMessage.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    res.status(200).json({ success: true, customers: customersWithLastMessage });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get single customer details by ID
exports.getCustomerDetail = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tenantId } = req.query;
    const query = tenantId ? { _id: customerId, tenantId } : { _id: customerId };
    const customer = await Customer.findOne(query);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.status(200).json({ success: true, customer });
  } catch (error) {
    console.error('Error fetching customer detail:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get messages for a specific customer
exports.getMessages = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { tenantId } = req.query;
    const query = tenantId ? { customerId, tenantId } : { customerId };
    
    const messages = await Message.find(query).sort({ createdAt: 1 });
    
    res.status(200).json({ success: true, messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Phase 9: Send Manual Message
exports.sendManualMessage = async (req, res) => {
  try {
    const { tenantId, customerId } = req.params;
    const { content } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const connectionManager = require('../services/whatsapp/connectionManager');
    const sock = connectionManager.getActiveSession(tenantId);
    
    if (!sock || !sock.user?.id) {
      return res.status(400).json({ error: 'WhatsApp session is not active or not logged in yet.' });
    }

    // Format destination JID (Handles LID identifiers like 110587002527830@lid or @s.whatsapp.net or raw digits)
    let targetJid = customer.whatsappNumber;
    if (!targetJid.includes('@')) {
      targetJid = `${targetJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    }

    // 1. Send "Typing..." status to the customer's WhatsApp
    try {
      await sock.sendPresenceUpdate('composing', targetJid);
    } catch (e) {
      console.warn('Failed to send composing presence:', e.message);
    }
    
    // 2. Add a tiny delay to make the typing indicator visible (1.5 seconds)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 3. Send the message via Baileys
    const sentMsg = await sock.sendMessage(targetJid, { text: content });

    // 4. Remove "Typing..." status
    try {
      await sock.sendPresenceUpdate('paused', targetJid);
    } catch (e) {
      console.warn('Failed to send paused presence:', e.message);
    }

    // Save outbound message to DB
    const outboundMsg = await Message.create({
      tenantId,
      customerId: customer._id,
      sender: 'agent', // Human agent
      content: content,
      messageId: sentMsg.key.id
    });

    // Auto-Pause AI when user manually sends message from Web App
    if (customer.autoPauseOnManual !== false && !customer.aiPaused) {
      customer.aiPaused = true;
      await customer.save();
      try {
        const { getIo } = require('../config/socket');
        const io = getIo();
        if (io) io.to(tenantId).emit('customer-updated', customer);
      } catch (sErr) {}
    }

    res.status(200).json({ success: true, message: outboundMsg });
  } catch (error) {
    console.error('Error sending manual message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

// Phase 9: Toggle AI Pause for Single Customer
exports.toggleAiPause = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { aiPaused } = req.body;

    const updateData = { aiPaused };
    if (!aiPaused) {
      updateData.aiPausedUntil = null;
      updateData.aiStatusState = 'ACTIVE_AI';
      updateData.lastResponseReason = '⚡ AI Unpaused manually by agent';
    } else {
      updateData.aiStatusState = 'PAUSED_MANUAL';
      updateData.lastResponseReason = '🛑 AI Paused manually by agent';
    }

    const customer = await Customer.findByIdAndUpdate(
      customerId, 
      updateData, 
      { returnDocument: 'after' }
    );

    res.status(200).json({ success: true, customer });
  } catch (error) {
    console.error('Error toggling AI pause:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Toggle AI Pause for ALL Customers of a Tenant + Set Global AI State
exports.toggleAllAiPause = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { aiPaused } = req.body;

    const Tenant = require('../models/Tenant');
    await Tenant.findByIdAndUpdate(tenantId, { aiAutoReplyDisabled: aiPaused });

    await Customer.updateMany(
      { tenantId },
      { $set: { aiPaused } }
    );

    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.to(tenantId).emit('global_ai_toggled', {
          aiAutoReplyDisabled: aiPaused
        });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      aiPaused,
      message: aiPaused
        ? '🛑 AI Auto-Response turned OFF globally.'
        : '🤖 AI Auto-Response turned ON globally.'
    });
  } catch (error) {
    console.error('Error toggling all AI pause:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Phase 9: Update Custom Prompt, AI Persona, Context Depth & Long-Term Memory
exports.updateCustomPrompt = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { customPrompt, aiPersona, aiVoiceGenderOverride, aiToneOverride, aiHistoryLimit, memorySummary, autoPauseOnManual, isBlacklisted } = req.body;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ error: 'Invalid Customer ID format' });
    }

    const updateFields = {};
    if (customPrompt !== undefined) updateFields.customPrompt = customPrompt;
    if (aiPersona !== undefined) updateFields.aiPersona = aiPersona;
    if (aiVoiceGenderOverride !== undefined) updateFields.aiVoiceGenderOverride = aiVoiceGenderOverride;
    if (aiToneOverride !== undefined) updateFields.aiToneOverride = aiToneOverride;
    if (aiHistoryLimit !== undefined) updateFields.aiHistoryLimit = Number(aiHistoryLimit);
    if (memorySummary !== undefined) updateFields.memorySummary = memorySummary;
    if (autoPauseOnManual !== undefined) updateFields.autoPauseOnManual = Boolean(autoPauseOnManual);
    if (isBlacklisted !== undefined) updateFields.isBlacklisted = Boolean(isBlacklisted);

    const customer = await Customer.findByIdAndUpdate(
      customerId, 
      updateFields, 
      { returnDocument: 'after' }
    );

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.status(200).json({ success: true, customer });
  } catch (error) {
    console.error('Error updating custom prompt & persona:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

exports.syncProfile = async (req, res) => {
  try {
    const { customerId } = req.params;
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const tenantId = customer.tenantId.toString();
    const { getActiveSession } = require('../services/whatsapp/connectionManager');
    const sock = getActiveSession(tenantId);
    
    if (!sock) return res.status(400).json({ error: 'WhatsApp is not connected' });

    let updated = false;
    
    if (!customer.profilePic) {
      try {
        const dpUrl = await sock.profilePictureUrl(customer.whatsappNumber, 'image');
        if (dpUrl) {
          customer.profilePic = dpUrl;
          updated = true;
        }
      } catch (err) {}
    }

    if (!customer.about && !customer.isGroup) {
      try {
        const statusData = await sock.fetchStatus(customer.whatsappNumber);
        if (statusData && statusData.status) {
          customer.about = statusData.status;
          updated = true;
        }
      } catch (err) {}
    }

    if (updated) {
      await customer.save();
    }

    res.status(200).json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

// Generate Icebreaker / Starter Conversation Message using AI
exports.generateStarterMessage = async (req, res) => {
  try {
    const { customerId } = req.params;
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const tenantId = customer.tenantId;
    const { generateAIResponse } = require('../services/aiService');

    const promptText = `[STARTER MESSAGE GENERATOR TASK]
Generate ONE single, ultra-creative, witty, and natural conversation starter message to open a chat with ${customer.name || 'this contact'} on WhatsApp.
Match their persona rules and specific custom prompt guidelines. Speak in natural Hinglish with 1-2 cool emojis. Keep it 1-2 short sentences. Do NOT output any preamble or quotation marks.`;

    const rawReply = await generateAIResponse(tenantId, customerId, promptText);
    let starterMessage = rawReply ? rawReply.replace(/\|\|\|/g, ' ').replace(/\"/g, '').trim() : "Hey! What's up? ✨";
    
    res.status(200).json({ success: true, starterMessage });
  } catch (error) {
    console.error('Failed to generate starter message', error);
    res.status(500).json({ error: 'Failed to generate starter message' });
  }
};
