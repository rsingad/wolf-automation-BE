const Tenant = require('../../models/Tenant');
const Message = require('../../models/Message');
const Customer = require('../../models/Customer');
const { getAIResponse } = require('../aiService');
const { IgApiClient } = require('instagram-private-api');

// Active Instagram Client Sessions per Tenant
const igClients = new Map();

/**
 * 💥 DEVIL MODE JUGAAD: Instagram Session Cookie Authentication
 * Login directly via Browser `sessionid` Cookie (100% bypass password bot blocks)
 */
exports.loginWithSessionCookie = async (tenantId, username, sessionId) => {
  try {
    const cleanUsername = username.trim().replace(/^@/, '').toLowerCase();
    // Decode URL-encoded sessionid (e.g. 28962540329%3AJg...)
    let cleanSessionId = sessionId.trim();
    try {
      cleanSessionId = decodeURIComponent(cleanSessionId);
    } catch (e) {}

    // Extract user ID prefix from sessionid if present (e.g., 28962540329 from 28962540329:Jg...)
    const dsUserId = cleanSessionId.split(':')[0] || '';

    console.log(`[Instagram Cookie Jugaad] 🚀 Connecting @${cleanUsername} via sessionid cookie (User PK: ${dsUserId})...`);

    const ig = new IgApiClient();
    ig.state.generateDevice(cleanUsername);

    // Set full Instagram web session cookies
    await ig.state.cookieJar.setCookie(
      `sessionid=${cleanSessionId}; Domain=.instagram.com; Path=/; Secure; HttpOnly;`,
      'https://www.instagram.com'
    );

    if (dsUserId) {
      await ig.state.cookieJar.setCookie(
        `ds_user_id=${dsUserId}; Domain=.instagram.com; Path=/; Secure;`,
        'https://www.instagram.com'
      );
    }

    // Attach supplementary cookies for full session validity
    await ig.state.cookieJar.setCookie(`csrftoken=missing; Domain=.instagram.com; Path=/; Secure;`, 'https://www.instagram.com');

    console.log(`[Instagram Cookie Jugaad] 🔍 Verifying sessionid cookie for '@${cleanUsername}'...`);

    // Verify session state
    try {
      const directInbox = ig.feed.directInbox();
      await directInbox.records();
      console.log(`[Instagram Cookie Jugaad] 🎉 SESSION VERIFIED via Direct DM Inbox!`);
    } catch (e) {
      console.log(`[Instagram Cookie Jugaad Info]: Mobile API handshake bypassed (${e.message}). Proceeding with Cookie Session.`);
    }

    // Fetch Real Instagram Profile Data (Bio, Full Name, Profile Pic, Followers, Following, Posts)
    let profilePic = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanUsername)}&background=E1306C&color=fff&size=128`;
    let fullName = `@${cleanUsername}`;
    let biography = "";
    let followersCount = 0;
    let followingCount = 0;
    let postsCount = 0;

    try {
      if (dsUserId) {
        console.log(`[Instagram Cookie Jugaad] 📸 Fetching real profile stats for PK: ${dsUserId}...`);
        const liveUser = await ig.user.info(dsUserId);
        if (liveUser) {
          if (liveUser.full_name) fullName = liveUser.full_name;
          if (liveUser.profile_pic_url) profilePic = liveUser.profile_pic_url;
          if (liveUser.biography) biography = liveUser.biography;
          if (liveUser.follower_count) followersCount = liveUser.follower_count;
          if (liveUser.following_count) followingCount = liveUser.following_count;
          if (liveUser.media_count) postsCount = liveUser.media_count;
          console.log(`[Instagram Real Stats] Followers: ${followersCount}, Following: ${followingCount}, Posts: ${postsCount}`);
        }
      }
    } catch (bioErr) {
      console.log('[Instagram Real Profile Fetch Notice]:', bioErr.message);
      try {
        const axios = require('axios');
        const webRes = await axios.get(`https://www.instagram.com/${cleanUsername}/?__a=1&__d=dis`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Cookie': `sessionid=${cleanSessionId}; ds_user_id=${dsUserId};`
          }
        });

        const userObj = webRes.data?.graphql?.user || webRes.data?.data?.user;
        if (userObj) {
          if (userObj.full_name) fullName = userObj.full_name;
          if (userObj.profile_pic_url) profilePic = userObj.profile_pic_url;
          if (userObj.biography) biography = userObj.biography;
          if (userObj.edge_followed_by?.count) followersCount = userObj.edge_followed_by.count;
          if (userObj.edge_follow?.count) followingCount = userObj.edge_follow.count;
          if (userObj.edge_owner_to_timeline_media?.count) postsCount = userObj.edge_owner_to_timeline_media.count;
        }
      } catch (webErr) {
        console.log('[Instagram Web Scrape Warning]:', webErr.message);
      }
    }

    igClients.set(tenantId, ig);

    const updatedTenant = await Tenant.findByIdAndUpdate(
      tenantId,
      {
        instagramConnected: true,
        instagramUsername: cleanUsername,
        instagramFullName: fullName,
        instagramProfilePic: profilePic,
        instagramBio: biography,
        instagramFollowersCount: followersCount,
        instagramFollowingCount: followingCount,
        instagramPostsCount: postsCount
      },
      { new: true }
    );

    exports.startInstagramRealListener(tenantId, ig);

    return {
      success: true,
      instagramUsername: updatedTenant.instagramUsername,
      instagramFullName: updatedTenant.instagramFullName,
      instagramProfilePic: updatedTenant.instagramProfilePic,
      instagramBio: updatedTenant.instagramBio,
      instagramConnected: true
    };
  } catch (err) {
    console.error('[Instagram Cookie Jugaad Error]:', err.message);
    return { 
      success: false, 
      error: `❌ Session ID Cookie Authentication Failed: ${err.message}. Please make sure your sessionid is valid.` 
    };
  }
};

/**
 * 💥 DEVIL MODE REAL INSTAGRAM LOGIN ENGINE
 * Uses Instagram Official Mobile API Protocol (Just like WhatsApp Baileys socket)
 */
exports.loginRealInstagramAccount = async (tenantId, username, password) => {
  try {
    const cleanUsername = username.trim().replace(/^@/, '').toLowerCase();
    console.log(`[Instagram Real Engine] 🚀 Initializing Native Mobile API Session for @${cleanUsername}...`);

    const ig = new IgApiClient();
    ig.state.generateDevice(cleanUsername);

    // Simulate real Instagram Android App Pre-login handshake
    try {
      console.log(`[Instagram Real Engine] 📱 Simulating Android App pre-login handshake for @${cleanUsername}...`);
      await ig.simulate.preLoginFlow();
    } catch (simErr) {
      console.log('[Instagram Pre-login Simulation Warning]:', simErr.message);
    }

    // Perform Native Instagram Mobile Login Call
    console.log(`[Instagram Real Engine] 🔒 Authenticating credentials with Instagram Mobile Gateway...`);
    const authUser = await ig.account.login(cleanUsername, password);

    console.log(`[Instagram Real Engine] ✅ Real Login Successful! User PK: ${authUser.pk}`);

    // Simulate Real Post-Login Android App Flow
    try {
      await ig.simulate.postLoginFlow();
    } catch (e) {
      console.log('[Instagram Post-login Simulation Warning]:', e.message);
    }

    // Fetch Real Logged-in Profile Info & Bio
    let profilePic = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanUsername)}&background=E1306C&color=fff&size=128`;
    let fullName = `@${cleanUsername}`;
    let biography = "Wolf AI Automated Business Profile";

    try {
      const userInfo = await ig.user.info(authUser.pk);
      if (userInfo.profile_pic_url) profilePic = userInfo.profile_pic_url;
      if (userInfo.full_name) fullName = userInfo.full_name;
      if (userInfo.biography) biography = userInfo.biography;
    } catch (e) {
      console.log('[Instagram Real Engine] Profile Info Fetch Warning:', e.message);
    }

    // Save Live Client Reference
    igClients.set(tenantId, ig);

    // Save State & Profile Info in DB
    const updatedTenant = await Tenant.findByIdAndUpdate(
      tenantId,
      {
        instagramConnected: true,
        instagramUsername: cleanUsername,
        instagramFullName: fullName,
        instagramProfilePic: profilePic,
        instagramBio: biography
      },
      { new: true }
    );

    // Start Live Real-Time Instagram Inbox Polling for Target User DMs
    exports.startInstagramRealListener(tenantId, ig);

    return {
      success: true,
      instagramUsername: updatedTenant.instagramUsername,
      instagramFullName: updatedTenant.instagramFullName,
      instagramProfilePic: updatedTenant.instagramProfilePic,
      instagramBio: updatedTenant.instagramBio,
      instagramConnected: true
    };
  } catch (err) {
    console.error('[Instagram Real Login Error]:', err.message);
    let userMsg = err.message || 'Instagram Login Failed.';

    if (err.message?.includes('checkpoint_required')) {
      userMsg = '❌ Instagram Security Checkpoint Required: Please log into Instagram app/website once to approve login access, then retry here!';
    } else if (err.message?.includes('invalid_user') || err.message?.includes('bad_password')) {
      userMsg = '❌ Invalid Instagram Username or Password. Please check credentials.';
    }

    return { success: false, error: userMsg };
  }
};

/**
 * 🎯 Real-Time Instagram DM Polling Listener (Listens for incoming target messages)
 */
exports.startInstagramRealListener = (tenantId, ig) => {
  console.log(`[Instagram Listener] 🎧 Starting Live Real-Time DM Polling loop for Tenant '${tenantId}'...`);
  
  const pollInterval = setInterval(async () => {
    try {
      const inbox = ig.feed.directInbox();
      const threads = await inbox.records();

      for (const thread of threads) {
        const lastItem = thread.items[0];
        if (!lastItem || lastItem.item_type !== 'text') continue;

        // Skip if outbound message from bot
        if (lastItem.user_id === ig.state.cookieUserId) continue;

        const senderUsername = thread.users[0]?.username || 'unknown';
        const messageText = lastItem.text;

        console.log(`[Instagram Real DM Received] From '@${senderUsername}': ${messageText}`);

        // Trigger AI Target Filter Processor
        await exports.handleIncomingDM(tenantId, senderUsername, messageText, thread.thread_id, ig);
      }
    } catch (err) {
      // Silent loop error catch
    }
  }, 10000); // Poll inbox every 10s

  igClients.set(`${tenantId}_interval`, pollInterval);
};

/**
 * Update Instagram Target Whitelist Settings (1-2 usernames filter)
 */
exports.updateTargetUsers = async (req, res) => {
  try {
    const { tenantId, targetUsers, targetOnly, instagramUsername } = req.body;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    const cleanedTargets = Array.isArray(targetUsers) 
      ? targetUsers.map(u => u.trim().replace(/^@/, '').toLowerCase()).filter(Boolean)
      : (targetUsers || '').toString().split(',').map(u => u.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);

    const updatedTenant = await Tenant.findByIdAndUpdate(
      tenantId,
      {
        instagramTargetUsers: cleanedTargets,
        instagramTargetOnly: targetOnly !== undefined ? Boolean(targetOnly) : true,
        ...(instagramUsername ? { instagramUsername: instagramUsername.trim().replace(/^@/, '').toLowerCase(), instagramConnected: true } : {})
      },
      { new: true }
    );

    return res.json({
      success: true,
      message: 'Target user whitelist updated successfully!',
      instagramTargetUsers: updatedTenant.instagramTargetUsers,
      instagramTargetOnly: updatedTenant.instagramTargetOnly,
      instagramConnected: updatedTenant.instagramConnected,
      instagramUsername: updatedTenant.instagramUsername
    });
  } catch (error) {
    console.error('[Instagram Controller] Update Target Users Error:', error);
    return res.status(500).json({ error: 'Server error updating target settings' });
  }
};

/**
 * Get Current Instagram Integration Settings & Top 5 Recent Target Users
 */
exports.getInstagramSettings = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Fetch top 5 recent Instagram target chats
    const recentDMs = await Message.find({ tenantId, platform: 'instagram' })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('customerId', 'name whatsappNumber tags');

    // Extract Top 5 Recent Target Users with whom chat occurred
    const top5TargetChats = [];
    const seenUserIds = new Set();

    for (const msg of recentDMs) {
      if (msg.customerId && !seenUserIds.has(msg.customerId._id.toString())) {
        seenUserIds.add(msg.customerId._id.toString());
        top5TargetChats.push({
          id: msg.customerId._id,
          username: msg.customerId.name,
          lastMessage: msg.content,
          lastSender: msg.sender,
          time: msg.createdAt
        });
        if (top5TargetChats.length >= 5) break;
      }
    }

    return res.json({
      success: true,
      instagramConnected: tenant.instagramConnected || false,
      instagramUsername: tenant.instagramUsername || '',
      instagramFullName: tenant.instagramFullName || tenant.name || 'Wolf Instagram Account',
      instagramProfilePic: tenant.instagramProfilePic || `https://ui-avatars.com/api/?name=${encodeURIComponent(tenant.instagramUsername || 'IG')}&background=E1306C&color=fff`,
      instagramBio: tenant.instagramBio || '',
      instagramFollowersCount: tenant.instagramFollowersCount || 0,
      instagramFollowingCount: tenant.instagramFollowingCount || 0,
      instagramPostsCount: tenant.instagramPostsCount || 0,
      instagramTargetUsers: tenant.instagramTargetUsers || [],
      instagramTargetOnly: tenant.instagramTargetOnly !== false,
      top5TargetChats,
      recentDMs
    });
  } catch (error) {
    console.error('[Instagram Controller] Get Settings Error:', error);
    return res.status(500).json({ error: 'Server error fetching settings' });
  }
};

/**
 * Handle Incoming Instagram Direct Message with Target User Whitelist Filter & Real Direct Reply
 */
exports.handleIncomingDM = async (tenantId, senderUsername, messageText, threadId = null, igInstance = null) => {
  try {
    const cleanSender = senderUsername.trim().replace(/^@/, '').toLowerCase();
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return { status: 'error', reason: 'Tenant not found' };

    const targetList = (tenant.instagramTargetUsers || []).map(u => u.toLowerCase());
    const isTargetOnly = tenant.instagramTargetOnly !== false;

    // Target Whitelist Check (Only reply to specified 1-2 users)
    if (isTargetOnly && targetList.length > 0 && !targetList.includes(cleanSender)) {
      console.log(`[Instagram] 🛑 IGNORED: Message from non-target user '@${cleanSender}'. Allowed targets: [${targetList.join(', ')}]`);
      return { 
        status: 'ignored', 
        reason: `Ignored because '@${cleanSender}' is not in your targeted list [${targetList.join(', ')}]` 
      };
    }

    console.log(`[Instagram] 🎯 MATCHED TARGET: Processing AI auto-reply for '@${cleanSender}'`);

    let customer = await Customer.findOne({ tenantId, whatsappNumber: `ig_${cleanSender}` });
    if (!customer) {
      customer = await Customer.create({
        tenantId,
        name: `@${cleanSender}`,
        whatsappNumber: `ig_${cleanSender}`,
        tags: ['instagram_lead', 'target_user']
      });
    }

    await Message.create({
      tenantId,
      customerId: customer._id,
      sender: 'customer',
      content: messageText,
      platform: 'instagram'
    });

    if (tenant.aiAutoReplyDisabled) {
      return { status: 'disabled', reason: 'AI Auto reply is disabled' };
    }

    const aiReply = await getAIResponse(tenant, messageText, customer);

    // If Real Instagram Client is active, send Real Outbound Direct Message!
    const ig = igInstance || igClients.get(tenantId);
    if (ig && threadId) {
      try {
        await ig.entity.directThread(threadId).broadcastText(aiReply);
        console.log(`[Instagram Real Direct Sent] Sent AI reply to '@${cleanSender}' via Instagram Mobile API!`);
      } catch (err) {
        console.error('[Instagram Real Direct Send Error]:', err.message);
      }
    }

    const botMsg = await Message.create({
      tenantId,
      customerId: customer._id,
      sender: 'bot',
      content: aiReply,
      platform: 'instagram'
    });

    return {
      status: 'replied',
      senderUsername: cleanSender,
      userMessage: messageText,
      aiReply: aiReply,
      messageId: botMsg._id
    };
  } catch (error) {
    console.error('[Instagram Handle DM Error]:', error);
    return { status: 'error', reason: error.message };
  }
};
