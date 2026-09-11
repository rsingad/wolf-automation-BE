const mongoose = require('mongoose');

const usageLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  model: { type: String, default: 'groq/compound-mini' },
  promptTokens: { type: Number, default: 0 },
  completionTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  estimatedCostUsd: { type: Number, default: 0 },
  latencyMs: { type: Number, default: 0 },
  isVoiceNoteSent: { type: Boolean, default: false },
  isBookingCreated: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('UsageLog', usageLogSchema);
