const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  packageName: {
    type: String,
    required: true
  },
  coinsAllocated: {
    type: Number,
    required: true
  },
  amountPaidInr: {
    type: Number,
    required: true
  },
  utrNumber: {
    type: String,
    required: true
  },
  paymentMethod: {
    type: String,
    default: 'UPI Scanner'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  verifiedAt: {
    type: Date
  }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
