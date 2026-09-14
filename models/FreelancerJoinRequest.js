const mongoose = require('mongoose');

const freelancerJoinRequestSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  photoUrl: { type: String, default: '' },
  skills: [{ type: String, required: true }],
  experienceLevel: { type: String, default: 'Mid-Level' },
  hourlyRate: { type: String, default: 'Negotiable' },
  portfolioUrl: { type: String, default: '' },
  githubUrl: { type: String, default: '' },
  bio: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['PENDING', 'APPROVED', 'REJECTED'], 
    default: 'PENDING' 
  },
  isFeaturedOnTeam: { type: Boolean, default: false },
  appliedAt: { type: Date, default: Date.now }
}, { 
  timestamps: true 
});

module.exports = mongoose.model('FreelancerJoinRequest', freelancerJoinRequestSchema);
