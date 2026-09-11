const mongoose = require('mongoose');

const dripJobSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  nodeIndex: { type: Number, required: true },
  template: { type: String, required: true },
  executeAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'completed', 'cancelled', 'failed'], default: 'pending' }
}, { timestamps: true });

// Create an index for quick cron job lookups
dripJobSchema.index({ status: 1, executeAt: 1 });

module.exports = mongoose.model('DripJob', dripJobSchema);
