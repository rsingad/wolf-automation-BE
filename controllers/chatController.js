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
    const customer = await Customer.findById(customerId);
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
    
    const messages = await Message.find({ customerId }).sort({ createdAt: 1 });
    
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

    // 1. Send "Typing..." status to the customer's WhatsApp
    try {
      await sock.sendPresenceUpdate('composing', customer.whatsappNumber);
    } catch (e) {
      console.warn('Failed to send composing presence:', e.message);
    }
    
    // 2. Add a tiny delay to make the typing indicator visible (1.5 seconds)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 3. Send the message via Baileys
    const sentMsg = await sock.sendMessage(customer.whatsappNumber, { text: content });

    // 4. Remove "Typing..." status
    try {
      await sock.sendPresenceUpdate('paused', customer.whatsappNumber);
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

    const customer = await Customer.findByIdAndUpdate(
      customerId, 
      { aiPaused }, 
      { new: true }
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

// Phase 9: Update Custom Prompt
exports.updateCustomPrompt = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { customPrompt } = req.body;

    const customer = await Customer.findByIdAndUpdate(
      customerId, 
      { customPrompt }, 
      { new: true }
    );

    res.status(200).json({ success: true, customer });
  } catch (error) {
    console.error('Error updating custom prompt:', error);
    res.status(500).json({ error: 'Server error' });
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
