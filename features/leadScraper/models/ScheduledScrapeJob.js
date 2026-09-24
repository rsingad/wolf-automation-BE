const mongoose = require('mongoose');

const scheduledScrapeJobSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  mode: {
    type: String,
    enum: ['keywords', 'ai_prompt'],
    default: 'keywords'
  },
  promptInput: {
    type: String,
    default: ''
  },
  keywords: [{
    type: String,
    trim: true
  }],
  cities: [{
    type: String,
    trim: true
  }],
  scheduleTime: {
    type: String, // HH:mm format e.g. "02:00" for 2 AM overnight
    default: '02:00'
  },
  isOvernightBatch: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed'],
    default: 'pending'
  },
  processedCount: {
    type: Number,
    default: 0
  },
  totalLeadsHarvested: {
    type: Number,
    default: 0
  },
  lastRunAt: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ScheduledScrapeJob', scheduledScrapeJobSchema);
