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
  safetyMode: { type: String, enum: ['safe', 'balanced', 'fast', 'stealth', 'custom'], default: 'safe' }, // Anti-ban speed mode
  customDelayMinSeconds: { type: Number, default: 15 },
  customDelayMaxSeconds: { type: Number, default: 40 },
  enableTwoStepShield: { type: Boolean, default: true }, // 2-Step Anti-Ban Shield (Strips URLs from cold 1st broadcast)
  autoOptOutFooter: { type: Boolean, default: true }, // Automatically append (Reply STOP to opt out)
  batchSplitSize: { type: Number, default: 0 }, // If > 0, auto-split large contact lists into mini queued batches
  promptVariationMode: { type: Boolean, default: true }, // Auto variation of AI prompt per batch
  dripNodes: [{
    template: { type: String, required: true },
    delayHours: { type: Number, required: true }
  }],
  status: { type: String, enum: ['pending', 'running', 'paused', 'completed'], default: 'pending' },
  pauseReason: { type: String, default: '' },
  contacts: [contactSchema],
  progress: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    ignored: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', campaignSchema);
