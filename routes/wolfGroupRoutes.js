const express = require('express');
const router = express.Router();
const FreelancerJoinRequest = require('../models/FreelancerJoinRequest');

// POST /api/join-request - Submit application
router.post('/join-request', async (req, res) => {
  try {
    const { 
      fullName, 
      email, 
      phone, 
      photoUrl, 
      skills, 
      experienceLevel, 
      hourlyRate, 
      portfolioUrl, 
      githubUrl, 
      bio, 
      appliedAt 
    } = req.body;

    // Validation
    if (!fullName || !email || !phone) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "fullName, email, and phone are required fields."
      });
    }

    if (!skills || !Array.isArray(skills) || skills.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Validation Error",
        message: "skills must be a non-empty array of strings."
      });
    }

    const newRequest = await FreelancerJoinRequest.create({
      fullName,
      email,
      phone,
      photoUrl: photoUrl || '',
      skills,
      experienceLevel: experienceLevel || 'Mid-Level',
      hourlyRate: hourlyRate || 'Negotiable',
      portfolioUrl: portfolioUrl || '',
      githubUrl: githubUrl || '',
      bio: bio || '',
      appliedAt: appliedAt ? new Date(appliedAt) : new Date()
    });

    return res.status(201).json({
      success: true,
      message: "Join request submitted successfully. Our team will contact you shortly.",
      data: {
        requestId: newRequest._id,
        status: newRequest.status
      }
    });

  } catch (error) {
    console.error("[Wolf Group API Error - Join Request]:", error);
    return res.status(500).json({
      success: false,
      error: "Server Error",
      message: "An internal server error occurred while processing your request."
    });
  }
});

// GET /api/team-members - Fetch approved team members for frontend
router.get('/team-members', async (req, res) => {
  try {
    const teamMembers = await FreelancerJoinRequest.find({
      $or: [{ status: 'APPROVED' }, { isFeaturedOnTeam: true }]
    }).sort({ createdAt: -1 });

    const formattedTeam = teamMembers.map(member => ({
      id: member._id,
      name: member.fullName.toUpperCase(),
      role: member.experienceLevel ? `${member.experienceLevel.toUpperCase()} FREELANCER` : 'TEAM MEMBER',
      phone: member.phone,
      specialty: member.bio || member.skills.join(', '),
      tags: member.skills,
      photoUrl: member.photoUrl,
      portfolioUrl: member.portfolioUrl,
      githubUrl: member.githubUrl
    }));

    return res.status(200).json({
      success: true,
      team: formattedTeam
    });

  } catch (error) {
    console.error("[Wolf Group API Error - Team Members]:", error);
    return res.status(500).json({
      success: false,
      error: "Server Error",
      message: "Failed to fetch team members."
    });
  }
});

module.exports = router;
