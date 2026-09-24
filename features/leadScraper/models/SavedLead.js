const mongoose = require('mongoose');

const savedLeadSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  query: {
    type: String,
    trim: true,
    required: true
  },
  businessName: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    default: '',
    trim: true
  },
  rating: {
    type: Number,
    default: 0
  },
  userRatingsTotal: {
    type: Number,
    default: 0
  },
  website: {
    type: String,
    default: '',
    trim: true
  },
  category: {
    type: String,
    default: 'General Business',
    trim: true
  },
  status: {
    type: String,
    enum: ['new', 'imported', 'blacklisted'],
    default: 'new'
  }
}, {
  timestamps: true
});

// Index for fast tenant search & phone uniqueness check
savedLeadSchema.index({ tenantId: 1, phone: 1 });

module.exports = mongoose.model('SavedLead', savedLeadSchema);
