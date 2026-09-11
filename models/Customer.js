const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  whatsappNumber: { type: String, required: true },
  aliasIds: [{ type: String }], // To handle @lid matches
  name: { type: String },
  profilePic: { type: String },
  about: { type: String },
  tags: [{ type: String }],
  aiTag: { type: String, enum: ['HOT LEAD', 'COMPLAINT', 'SUPPORT', 'GENERAL', 'SPAM', null], default: null },
  customPrompt: { type: String }, // Specific prompt for this customer
  aiPaused: { type: Boolean, default: false }, // True if Human-in-the-loop takeover
  isGroup: { type: Boolean, default: false },
  groupMetadata: { type: Object }, // Store group members/info
  deviceType: { type: String, default: 'unknown' }, // 'ios', 'android', 'web', 'unknown'
  lastActiveAt: { type: Date } // True last seen (Ghost Mode tracker)
}, { timestamps: true });

// A customer's whatsapp number should be unique per tenant
customerSchema.index({ tenantId: 1, whatsappNumber: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
