const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  sender: { type: String, enum: ['customer', 'bot', 'agent'], required: true },
  content: { type: String, required: true },
  messageId: { type: String }, // WhatsApp message ID for reference
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  participantJid: { type: String }, // For group messages, who actually sent it
  participantName: { type: String }, // For group messages, name of the sender
  deletedBySender: { type: Boolean, default: false }, // Anti-delete feature
  mediaUrl: { type: String }, // Path to downloaded media
  mediaType: { type: String, enum: ['image', 'video', 'audio', 'document'] },
  isViewOnce: { type: Boolean, default: false } // DEVIL MODE: Anti-View Once
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
