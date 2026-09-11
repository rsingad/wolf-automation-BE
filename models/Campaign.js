const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  phone: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'ignored'], default: 'pending' },
  error: { type: String }
});

const campaignSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  template: { type: String, required: true },
  mediaUrl: { type: String, default: '' }, // Photo / Image attachment URL or path
  safetyMode: { type: String, enum: ['safe', 'balanced', 'fast'], default: 'safe' }, // Anti-ban speed mode
  dripNodes: [{
    template: { type: String, required: true },
    delayHours: { type: Number, required: true }
  }],
  status: { type: String, enum: ['pending', 'running', 'paused', 'completed'], default: 'pending' },
  contacts: [contactSchema],
  progress: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    ignored: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', campaignSchema);
