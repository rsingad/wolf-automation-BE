const express = require('express');
const router = express.Router();
const instagramService = require('../services/instagram/instagramService');
const Tenant = require('../models/Tenant');

// Get current Instagram settings
router.get('/settings/:tenantId', instagramService.getInstagramSettings);

// Login Instagram account (Real Native Mobile API Engine - Baileys style socket)
router.post('/login', async (req, res) => {
  try {
    const { tenantId, username, password } = req.body;
    if (!tenantId || !username || !password) {
      return res.status(400).json({ error: 'Tenant ID, Username, and Password are required.' });
    }

    // Call Real Instagram Mobile API Engine
    const result = await instagramService.loginRealInstagramAccount(tenantId, username, password);

    if (!result.success) {
      return res.status(401).json({ error: result.error || 'Failed to authenticate Instagram account.' });
    }

    return res.json({
      success: true,
      message: '🎉 Real Instagram Mobile Session Connected & Listening!',
      instagramUsername: result.instagramUsername,
      instagramFullName: result.instagramFullName,
      instagramProfilePic: result.instagramProfilePic,
      instagramConnected: true
    });
  } catch (error) {
    console.error('[Instagram Login Error]:', error);
    return res.status(500).json({ error: 'Failed to authenticate Instagram credentials.' });
  }
});

// Login Instagram account via Session Cookie (100% Bypass Password bot blocks)
router.post('/login-session-cookie', async (req, res) => {
  try {
    const { tenantId, username, sessionId } = req.body;
    if (!tenantId || !username || !sessionId) {
      return res.status(400).json({ error: 'Tenant ID, Username, and Session ID Cookie are required.' });
    }

    const result = await instagramService.loginWithSessionCookie(tenantId, username, sessionId);

    if (!result.success) {
      return res.status(401).json({ error: result.error || 'Failed to authenticate via sessionid cookie.' });
    }

    return res.json({
      success: true,
      message: '🎉 Real Instagram Session Connected via Session Cookie!',
      instagramUsername: result.instagramUsername,
      instagramFullName: result.instagramFullName,
      instagramProfilePic: result.instagramProfilePic,
      instagramBio: result.instagramBio,
      instagramConnected: true
    });
  } catch (error) {
    console.error('[Instagram Cookie Login Error]:', error);
    return res.status(500).json({ error: 'Failed to authenticate Instagram cookie session.' });
  }
});

// Disconnect Instagram account
router.post('/disconnect', async (req, res) => {
  try {
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required.' });

    await Tenant.findByIdAndUpdate(tenantId, {
      instagramConnected: false,
      instagramUsername: ''
    });

    return res.json({ success: true, message: 'Instagram Account disconnected.' });
  } catch (error) {
    console.error('[Instagram Disconnect Error]:', error);
    return res.status(500).json({ error: 'Failed to disconnect account.' });
  }
});

// Update targeted user whitelist (1-2 usernames)
router.post('/targets', instagramService.updateTargetUsers);

// Test/Simulate incoming Direct Message to verify target filter logic
router.post('/simulate-dm', async (req, res) => {
  try {
    const { tenantId, senderUsername, messageText } = req.body;
    if (!tenantId || !senderUsername || !messageText) {
      return res.status(400).json({ error: 'tenantId, senderUsername, and messageText are required' });
    }

    const result = await instagramService.handleIncomingDM(tenantId, senderUsername, messageText);
    return res.json({ success: true, result });
  } catch (error) {
    console.error('[Instagram Simulation Error]:', error);
    return res.status(500).json({ error: 'Failed to process simulated DM' });
  }
});

module.exports = router;
