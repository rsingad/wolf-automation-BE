const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  whatsappNumber: { type: String, required: true },
  aliasIds: [{ type: String }], // To handle @lid matches
  name: { type: String },
  profilePic: { type: String },
  about: { type: String },
  tags: [{ type: String }],
  aiTag: { type: String, enum: ['HOT LEAD', 'COMPLAINT', 'SUPPORT', 'GENERAL', 'SPAM', null], default: null },
  customPrompt: { type: String }, // Specific prompt for this customer
  aiPersona: { type: String, enum: ['default', 'human_team_member', 'wolf_team_human', 'loving_boyfriend', 'female_crush', 'friendly_girl', 'executive_male', 'flirty_hinglish', 'strict_manager'], default: 'default' }, // AI Persona Override
  aiVoiceGenderOverride: { type: String, enum: ['default', 'female', 'male'], default: 'default' },
  aiToneOverride: { type: String, default: '' }, // e.g. "Flirty, sweet, romantic Hinglish"
  currentMood: { type: String, enum: ['NEUTRAL', 'HAPPY', 'SAD_TIRED', 'ANGRY_UPSET', 'FLIRTY_PLAYFUL', 'STRESSED'], default: 'NEUTRAL' },
  detectedSentiment: { type: String, default: 'Neutral & Calm' },
  lastEmotionUpdate: { type: Date },
  aiHistoryLimit: { type: Number, default: 40 }, // History message context depth (40, 80, 150, 200 msgs)
  memorySummary: { type: String, default: '' }, // Persistent long-term memory facts (e.g. GF likes, birthdays, promises)
  aiPaused: { type: Boolean, default: false }, // True if Human-in-the-loop takeover
  isAiEnabled: { type: Boolean, default: false }, // Explicit VIP AI Activation switch per customer
  aiPausedUntil: { type: Date }, // 5-Minute Smart Auto-Resume Timer
  aiStatusState: { type: String, enum: ['ACTIVE_AI', 'PAUSED_MANUAL', 'SKIPPED_PREFIX', 'SKIPPED_WARMUP_LIMIT', 'SKIPPED_OUT_OF_HOURS', 'SKIPPED_GLOBAL_OFF', 'GENERATING_REPLY', 'ERROR_API_RATE_LIMIT', 'ERROR_CONTEXT_LENGTH_EXCEEDED', 'ERROR_DB_FAILURE', 'ERROR_SERVER_OUTAGE'], default: 'ACTIVE_AI' },
  lastResponseReason: { type: String, default: 'AI active & ready to respond' },
  autoPauseOnManual: { type: Boolean, default: true }, // Auto-pause AI when agent types manually
  isBlacklisted: { type: Boolean, default: false }, // Exclude/Blacklist from Campaign Broadcasts
  isGroup: { type: Boolean, default: false },
  groupMetadata: { type: Object }, // Store group members/info
  deviceType: { type: String, default: 'unknown' }, // 'ios', 'android', 'web', 'unknown'
  lastActiveAt: { type: Date } // True last seen (Ghost Mode tracker)
}, { timestamps: true });

// A customer's whatsapp number should be unique per tenant
customerSchema.index({ tenantId: 1, whatsappNumber: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
