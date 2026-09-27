const mongoose = require('mongoose');

const pageViewSchema = new mongoose.Schema({
  visitorId: {
    type: String,
    required: true,
    index: true
  },
  ip: String,
  userAgent: String,
  path: {
    type: String,
    default: '/'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PageView', pageViewSchema);
