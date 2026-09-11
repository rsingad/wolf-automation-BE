const Tenant = require('../models/Tenant');

/**
 * Calculates and returns the WhatsApp Account Health & Warm-Up Level details for a tenant.
 * Levels:
 * Level 1 (Warmup Tier, 0-3 days): 50 msgs/day, 8-15s delay
 * Level 2 (Growth Tier, 4-10 days): 250 msgs/day, 5-10s delay
 * Level 3 (Pro Tier, 11-30 days): 1,000 msgs/day, 3-7s delay
 * Level 4 (Enterprise Tier, 30+ days): 5,000 msgs/day, 2-5s delay
 */
async function getTenantWarmupStatus(tenantId) {
  try {
    let tenant = null;
    if (typeof tenantId === 'object' && tenantId._id) {
      tenant = tenantId;
    } else {
      tenant = await Tenant.findById(tenantId);
    }

    if (!tenant) {
      return {
        level: 1,
        levelName: '🌱 Level 1: Warmup Tier',
        dailyLimit: 50,
        dailySent: 0,
        dailyRemaining: 50,
        minDelayMs: 8000,
        maxDelayMs: 15000,
        progressPercent: 0
      };
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // Reset daily count if date has changed
    if (tenant.lastDailyResetDate !== todayStr) {
      tenant.dailyMessagesSent = 0;
      tenant.lastDailyResetDate = todayStr;
      await tenant.save();
    }

    const createdAt = tenant.createdAt ? new Date(tenant.createdAt) : new Date();
    const accountAgeDays = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)));

    let level = 1;
    let levelName = '🐾 Level 1: Lone Wolf Pup (Warmup Shield)';
    let levelBadge = '🐾 Lone Wolf Pup';
    let dailyLimit = 50;
    let minDelayMs = 8000;
    let maxDelayMs = 15000;
    let nextLevelInDays = 4 - accountAgeDays;
    let unlockedFeatures = ['AI Auto-Reply', 'Safe 50 Msgs/Day Broadcasts', 'Anti-Ban Shield'];

    if (accountAgeDays >= 30 || (tenant.totalLifetimeMessagesSent || 0) >= 5000) {
      level = 4;
      levelName = '👑 Level 4: Fenrir Sovereign (Godmode Enterprise)';
      levelBadge = '👑 Fenrir Sovereign';
      dailyLimit = 5000;
      minDelayMs = 2000;
      maxDelayMs = 5000;
      nextLevelInDays = 0;
      unlockedFeatures = ['Unlimited High-Speed Broadcasts', 'Instant Voice Notes', 'Priority Engine', 'Zero Delay Risk'];
    } else if (accountAgeDays >= 11 || (tenant.totalLifetimeMessagesSent || 0) >= 1000) {
      level = 3;
      levelName = '🔥 Level 3: Alpha Enforcer (Pro Dominance)';
      levelBadge = '🔥 Alpha Enforcer';
      dailyLimit = 1000;
      minDelayMs = 3000;
      maxDelayMs = 7000;
      nextLevelInDays = 30 - accountAgeDays;
      unlockedFeatures = ['1,000 Msgs/Day Broadcasts', 'Multi-Step Drip Campaigns', 'Voice Notes & Booking'];
    } else if (accountAgeDays >= 4 || (tenant.totalLifetimeMessagesSent || 0) >= 200) {
      level = 2;
      levelName = '🐺 Level 2: Beta Hunter (Growth Engine)';
      levelBadge = '🐺 Beta Hunter';
      dailyLimit = 250;
      minDelayMs = 5000;
      maxDelayMs = 10000;
      nextLevelInDays = 11 - accountAgeDays;
      unlockedFeatures = ['250 Msgs/Day Broadcasts', 'Voice Notes Active', 'Smart Auto-Booking'];
    }

    // Auto update tenant account level if changed
    if (tenant.accountLevel !== level) {
      tenant.accountLevel = level;
      await tenant.save();
    }

    const dailySent = tenant.dailyMessagesSent || 0;
    const dailyRemaining = Math.max(0, dailyLimit - dailySent);
    const progressPercent = Math.min(100, Math.round((dailySent / dailyLimit) * 100));

    return {
      level,
      levelName,
      levelBadge,
      accountAgeDays,
      dailyLimit,
      dailySent,
      dailyRemaining,
      minDelayMs,
      maxDelayMs,
      nextLevelInDays: Math.max(0, nextLevelInDays),
      progressPercent,
      unlockedFeatures,
      totalLifetimeMessagesSent: tenant.totalLifetimeMessagesSent || 0
    };
  } catch (error) {
    console.error('Error fetching tenant warmup status:', error);
    return {
      level: 1,
      levelName: '🌱 Level 1: Warmup Tier',
      dailyLimit: 50,
      dailySent: 0,
      dailyRemaining: 50,
      minDelayMs: 8000,
      maxDelayMs: 15000,
      progressPercent: 0
    };
  }
}

/**
 * Increment daily message count for tenant
 */
async function recordOutboundMessage(tenantId) {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return;

    if (tenant.lastDailyResetDate !== todayStr) {
      tenant.dailyMessagesSent = 1;
      tenant.lastDailyResetDate = todayStr;
    } else {
      tenant.dailyMessagesSent = (tenant.dailyMessagesSent || 0) + 1;
    }

    tenant.totalLifetimeMessagesSent = (tenant.totalLifetimeMessagesSent || 0) + 1;
    await tenant.save();
  } catch (e) {
    console.error('Error recording outbound message count:', e.message);
  }
}

module.exports = {
  getTenantWarmupStatus,
  recordOutboundMessage
};
