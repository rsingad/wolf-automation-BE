const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  whatsappNumber: { type: String }, // Populated when they connect Baileys
  botPrompt: { 
    type: String, 
    default: "You are a helpful AI assistant for this business." 
  },
  knowledgeBaseText: {
    type: String,
    default: ""
  },
  businessHours: {
    start: { type: String, default: "09:00" },
    end: { type: String, default: "18:00" },
    outOfHoursMessage: { type: String, default: "We are currently closed. We will reply as soon as we open." },
    outOfHoursAction: { type: String, enum: ['ai_natural', 'silent', 'template'], default: 'ai_natural' }
  },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  ghostMode: { type: Boolean, default: false }, // DEVIL MODE: Hide Read Receipts
  aiVoiceEnabled: { type: Boolean, default: false }, // AI Voice Note Toggle
  aiVoiceMode: { type: String, enum: ['both', 'voice_only', 'text_only'], default: 'both' }, // Voice Mode
  aiVoiceGender: { type: String, enum: ['female', 'male'], default: 'female' },
  aiVoiceActor: { type: String, default: 'hi-IN-SwaraNeural' }, // Neural voice model ID
  aiVoiceSpeed: { type: String, default: '+0%' }, // Speech rate adjustments
  aiVoiceLanguage: { type: String, default: 'hi' }, // Default language (Hindi/Hinglish)
  bookingEnabled: { type: Boolean, default: true }, // AI Booking System Toggle
  bookingSlotDuration: { type: Number, default: 30 }, // Minutes per slot
  autoConfirmBooking: { type: Boolean, default: true }, // Auto confirm bookings
  servicesList: { type: [String], default: ["General Consultation", "Service Inquiry", "Booking / Reservation"] },
  webSearchEnabled: { type: Boolean, default: true }, // Live Web Browsing Toggle
  businessWebsiteUrl: { type: String, default: "" }, // Custom business website URL to scrape
  aiAutoReplyDisabled: { type: Boolean, default: false }, // Global AI Auto-Reply Off Switch
  accountLevel: { type: Number, default: 1 }, // 1: Warmup, 2: Growth, 3: Pro, 4: Enterprise
  dailyMessagesSent: { type: Number, default: 0 }, // Daily outbound count
  lastDailyResetDate: { type: String, default: "" }, // ISO date YYYY-MM-DD
  role: { type: String, enum: ['tenant', 'admin', 'master_admin'], default: 'tenant' }, // Master Admin access control
  masterSecretPin: { type: String, default: "" }, // Secret Pin for Master Admin access
  isFrozen: { type: Boolean, default: false }, // Super Owner Account Freeze Status
  freezeReason: { type: String, default: "" }, // Freeze Reason (e.g., Free Demo Expired, Violation)
  freezeDate: { type: Date },
  instagramConnected: { type: Boolean, default: false },
  instagramUsername: { type: String, default: "" },
  instagramFullName: { type: String, default: "" },
  instagramProfilePic: { type: String, default: "" },
  instagramBio: { type: String, default: "" },
  instagramFollowersCount: { type: Number, default: 0 },
  instagramFollowingCount: { type: Number, default: 0 },
  instagramPostsCount: { type: Number, default: 0 },
  instagramTargetUsers: { type: [String], default: [] }, // Specific targeted 1-2 usernames filter (lowercase)
  instagramTargetOnly: { type: Boolean, default: true }, // Reply ONLY to targeted users
  wolfCoins: { type: Number, default: 500000 },
  wolfTokenBalance: { type: Number, default: 500000 }, // Default 500,000 Wolf Tokens allocated
  totalWolfTokensAllocated: { type: Number, default: 500000 }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
