const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  actionType: { type: String, enum: ['presence_available', 'presence_composing', 'message_sent'], required: true },
  timestamp: { type: Date, default: Date.now }
});

// Index for fast querying by customer
activityLogSchema.index({ tenantId: 1, customerId: 1, timestamp: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
