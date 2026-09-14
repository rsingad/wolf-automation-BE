const OpenAI = require('openai');
const Tenant = require('../models/Tenant');
const Customer = require('../models/Customer');
const Message = require('../models/Message');

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

/**
 * Generate a smart reply based on conversation history and bot prompts.
 * @param {string} tenantId 
 * @param {string} customerId 
 * @param {string} incomingMessage 
 * @returns {string} AI Response
 */
async function generateAIResponse(tenantId, customerId, incomingMessage) {
  try {
    // 1. Fetch Tenant settings
    let tenant = null;
    try {
      tenant = await Tenant.findById(tenantId);
    } catch (e) {}

    if (!tenant) {
      // Fallback to first tenant in DB if ID doesn't match
      tenant = await Tenant.findOne();
    }

    if (tenant && tenant.isFrozen) {
      console.log(`[AI] Skipped replying because tenant ${tenant.name} is FROZEN by Super Owner. Reason: ${tenant.freezeReason}`);
      return "⚠️ Notice: This business account is currently paused/frozen by system administration. Please contact support to restore services.";
    }

    // 2. Fetch Customer specifics
    const customer = await Customer.findById(customerId);
    
    // If AI is paused for this customer, return null so we don't reply
    if (customer && customer.aiPaused) {
      console.log(`[AI] Skipped replying to customer ${customerId} because AI is paused.`);
      return null;
    }

    // 3. Dynamic History Depth (Configurable 40 to 200 messages for full deep memory)
    const historyLimit = customer?.aiHistoryLimit || 40;
    const recentMessages = await Message.find({ tenantId, customerId })
      .sort({ createdAt: -1 })
      .limit(historyLimit)
      .lean();
    
    // Reverse them to chronological order
    recentMessages.reverse();

    // 4. Construct the prompt
    let systemPrompt = `You are a real human replying naturally on WhatsApp/Instagram. 
STRICT ANTI-BOT & HUMAN DISGUISE RULES (CRITICAL):
1. UNDER NO CIRCUMSTANCES should you EVER reveal, hint, or admit that you are an AI, language model, ChatGPT, bot, or automated system.
2. If asked "Are you a bot?", "Are you AI?", "Kya tum AI ho?", ALWAYS reply like a natural human with humor/warmth (e.g. "Haha pagal ho kya, main insan hi hoon! 😂", "Nahi re, main hi bol rahi/raha hoon!").
3. Speak naturally with realistic human expressions, informal tone, lowercase typing habits when casual, natural Hinglish/Hindi/English, and warm emojis (✨, 😊, 🙈, 💖).
4. NEVER use formal AI phrases like "As an AI language model", "How can I assist you today?", or "I am programmed to".
5. Match the EXACT emotion, speed, language, and slang of the user.`;

    // 🧠 PERSISTENT LONG-TERM MEMORY (GF/VIP Facts, Birthday, Promises, Favorites)
    if (customer && customer.memorySummary) {
      systemPrompt += `\n\n[PERSISTENT LONG-TERM MEMORY & FACTS ABOUT THIS PERSON]
You have the following permanent memory facts stored about this specific person. ALWAYS remember these facts throughout the conversation:
"${customer.memorySummary}"`;
    }

    // 🎭 MOOD-BASED DYNAMIC EMOTION SWITCHER ENGINE
    if (customer && customer.currentMood && customer.currentMood !== 'NEUTRAL') {
      systemPrompt += `\n\n[REAL-TIME MOOD & SENTIMENT TRACKER]
Detected Current Customer Emotion: ${customer.currentMood} (${customer.detectedSentiment || 'Dynamic Sentiment'}).
EMOTION-ADAPTIVE BEHAVIOR RULES (CRITICAL):
- If SAD_TIRED: Immediately drop all business/casual tone. Be empathetic, soft, ultra-comforting, offer warm listening. Use soothing Hinglish & gentle emojis (🌸, 🫂, ✨).
- If ANGRY_UPSET: Do NOT argue. Be extremely polite, validating, calm, and reassuring. Offer instant solutions or peaceful support.
- If HAPPY / FLIRTY_PLAYFUL: Be enthusiastic, match her high energy, witty, playful, and fun!
- If STRESSED: Offer calm guidance, ask how you can lighten her load, be a supportive anchor.`;
    }

    systemPrompt += `\n\n[AUTO LONG-TERM MEMORY & SENTIMENT ANALYZER]
1. If user shares personal facts, append tag [SAVE_FACT: Fact details] at the end.
2. AUTOMATICALLY ANALYZE USER'S MOOD in this message and append tag [UPDATE_MOOD: MOOD_NAME | Sentiment Summary] at the end of your response.
Allowed MOOD_NAME values: HAPPY, SAD_TIRED, ANGRY_UPSET, FLIRTY_PLAYFUL, STRESSED, NEUTRAL.
Example: "Aww rest karlo thoda ji! 🌸 [UPDATE_MOOD: SAD_TIRED | User mentioned being exhausted after long day]"
The system will automatically extract and save the updated mood!`;

    if (tenant && tenant.botPrompt) {
      systemPrompt += `\n\n[GLOBAL BUSINESS RULE]\n${tenant.botPrompt}`;
    }

    if (tenant && tenant.knowledgeBaseText) {
      systemPrompt += `\n\n[BUSINESS KNOWLEDGE BASE]\nUse the following information to answer customer queries accurately. If the answer is not here, use your best judgment or politely say you don't know and will check with the team:\n${tenant.knowledgeBaseText}`;
    }

    if (customer && customer.customPrompt) {
      systemPrompt += `\n\n[CRITICAL USER-SPECIFIC OVERRIDE]\nThe following rules are specifically for THIS user. You MUST prioritize these instructions above all other global rules:\n"${customer.customPrompt}"`;
    }

    // 🎭 AI PERSONA OVERRIDE (e.g. Friendly Girl, Cute Female, Romantic Hinglish)
    if (customer && customer.aiPersona && customer.aiPersona !== 'default') {
      const orgName = tenant?.name || 'our company';
      const personaPrompts = {
        human_team_member: `\n\n[PERSONA MODE: REAL HUMAN TEAM CONSULTANT]
You are a real human team member at ${orgName}.
CRITICAL RULES:
1. ALWAYS act like a real human writing on WhatsApp. NEVER mention or admit being AI, bot, or language model.
2. Reply in short 1-2 line messages. Avoid formal essays, bullets, or robotic formatting.
3. Use natural human fillers ("Haanji", "Ji bilkul", "Actually", "Dekho", "Ek kaam karo", "Thik hai", "Bhai/Sir").
4. Match client's exact language (Hinglish, Hindi, English).
5. Be super helpful, professional, and knowledgeable about ${orgName}'s products and services.`,
        wolf_team_human: `\n\n[PERSONA MODE: REAL HUMAN TECH CONSULTANT]
You are a real human team member at ${orgName}.
CRITICAL RULES:
1. ALWAYS act like a real human writing on WhatsApp. NEVER mention or admit being AI, bot, or language model.
2. Reply in short 1-2 line messages. Avoid formal essays, bullets, or robotic formatting.
3. Use natural human fillers ("Haanji", "Ji bilkul", "Actually", "Dekho", "Ek kaam karo", "Thik hai", "Bhai/Sir").
4. Match client's exact language (Hinglish, Hindi, English).
5. Be super helpful, professional, and knowledgeable about ${orgName}'s products and services.`,
        loving_boyfriend: `\n\n[PERSONA MODE: CARING & ROMANTIC BOYFRIEND]
You are a caring, romantic, attentive, and sweet boyfriend replying to your girlfriend on WhatsApp. Speak in warm, natural Hinglish with sweet emojis (❤️, ✨, 😊, 🙈, 💖). Be loving, supportive, ask about her day, listen to her, and make her feel special and cared for. Never sound like a bot or business assistant.`,
        female_crush: `\n\n[PERSONA MODE: CUTE & SWEET FEMALE FRIEND]
You are a sweet, charming, caring Indian girl replying on WhatsApp. Speak in natural, cute Hinglish with modern emojis (😊, ✨, 🙈, 💖). Be friendly, attentive, polite, and playful. Never sound like a formal company or bot.`,
        friendly_girl: `\n\n[PERSONA MODE: FRIENDLY GIRL REPRESENTATIVE]
You are a cheerful, friendly female assistant named Swara/Neha. Use warm Hinglish, helpful tone, and light emojis. Make the conversation feel natural, personal, and comfortable.`,
        flirty_hinglish: `\n\n[PERSONA MODE: CHARMING & FLIRTY HINGLISH]
You are a witty, charming, and playfully flirty companion. Speak in fun Hinglish with cute emojis (😉, 🙈, ✨, ☕). Be sweet, engaging, and delightfully conversational.`,
        executive_male: `\n\n[PERSONA MODE: PROFESSIONAL EXECUTIVE]
You are a sharp, polite, and confident male senior executive. Speak clearly, professionally, and respectfully in crisp Hinglish/English.`,
        strict_manager: `\n\n[PERSONA MODE: TOUGH NEGOTIATOR & MANAGER]
You are a firm, direct business manager. Speak concisely, clearly, and stick strictly to business terms.`
      };

      if (personaPrompts[customer.aiPersona]) {
        systemPrompt += personaPrompts[customer.aiPersona];
      }
    }

    if (customer && customer.aiToneOverride) {
      systemPrompt += `\n\n[CUSTOM TONE INSTRUCTION]: Speak in the following tone: ${customer.aiToneOverride}`;
    }

    // AI Booking System Rules
    if (!tenant || tenant.bookingEnabled !== false) {
      const services = (tenant && tenant.servicesList && tenant.servicesList.length > 0) 
        ? tenant.servicesList.join(', ') 
        : "General Consultation, Booking";

      systemPrompt += `\n\n[APPOINTMENT & BOOKING SYSTEM ENABLED]
Available Services: ${services}.

--- CREATING A NEW BOOKING ---
If the user wants to book, schedule, or reserve an appointment/slot:
1. Ask for their preferred date and time if not provided.
2. Once the user provides a service, date (YYYY-MM-DD), and time (HH:MM), append the tag: [CREATE_BOOKING: Service Name | YYYY-MM-DD | HH:MM]
Example: "Aapki appointment book ho gayi! [CREATE_BOOKING: General Consultation | 2026-07-25 | 16:00]"

--- CANCELLING A BOOKING ---
If the user says they want to CANCEL their appointment (uses words like: cancel, band karo, nahi chahiye, hata do):
- Confirm politely and append exactly: [CANCEL_BOOKING]
Example: "Ji bilkul, aapki appointment cancel kar di gayi hai. [CANCEL_BOOKING]"

--- RESCHEDULING A BOOKING ---
If the user wants to CHANGE or RESCHEDULE their appointment (uses words like: change karo, alag time, reschedule, shift karo):
- Ask for the new date/time if not given.
- Once they confirm, append: [RESCHEDULE_BOOKING: YYYY-MM-DD HH:MM]
Example: "Aapki appointment naye time pe shift kar di hai. [RESCHEDULE_BOOKING: 2026-08-10 14:00]"

IMPORTANT: Only output ONE action tag per reply. Never output multiple booking tags together.`;
    }

    // Phase 24: Inject Rich Media Assets
    const MediaAsset = require('../models/MediaAsset');
    const assets = await MediaAsset.find({ tenantId });
    if (assets.length > 0) {
      const assetKeywords = assets.map(a => a.keyword).join(', ');
      systemPrompt += `\n\n[MEDIA ASSETS AVAILABLE]
You have the following rich media assets available to send to the user: ${assetKeywords}.
If the user asks for any of these (e.g., catalog, menu), you MUST include exactly the tag [SEND_ASSET: KEYWORD] anywhere in your response, replacing KEYWORD with the exact keyword from the list. 
The system will intercept this tag and automatically send the image/document to the user along with your text message.`;
    }

    // Live Web Browsing & Dynamic Price Lookup
    if (!tenant || tenant.webSearchEnabled !== false) {
      const lastMsgText = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1].content : "";
      const priceKeywords = ['price', 'rate', 'cost', 'today', 'live', 'search', 'kitne ka', 'daam', 'bhav', 'fees', 'website'];
      
      const needsSearch = priceKeywords.some(kw => lastMsgText.toLowerCase().includes(kw));
      if (needsSearch) {
        try {
          const { searchWeb } = require('./webSearchService');
          const webResult = await searchWeb(lastMsgText);
          systemPrompt += `\n\n[LIVE REAL-TIME WEB SEARCH DATA]\n${webResult}\nUse this live web data to accurately answer price inquiries or current information.`;
        } catch (sErr) {
          console.error('[AI Service] Web search failed:', sErr.message);
        }
      }
    }

    // --- PARTICIPANT IDENTITY & ROLE CLARITY (CRITICAL ROLE DISTINCTION) ---
    const targetCustomerName = customer?.name ? customer.name.replace(' (Private ID)', '') : 'the other person';
    systemPrompt += `\n\n[CONVERSATION PARTICIPANTS & CHAT ROLES - DO NOT MIX UP!]
- YOUR ROLE (assistant): You are replying as Ramesh (the account owner). Every history message marked as 'assistant' was sent by YOU (Ramesh).
- OTHER PERSON (user): You are chatting with ${targetCustomerName}. Every history message marked as 'user' was sent by ${targetCustomerName}.
- CRITICAL DIRECTION: Reply TO ${targetCustomerName} as Ramesh. Never confuse ${targetCustomerName}'s statements with your own. Answer what ${targetCustomerName} asked in their latest message!`;

    // --- CHRONOLOGICAL CONTEXT ---
    const now = new Date();
    const istTime = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    
    systemPrompt += `\n\n[CONTEXT]
The current time is: ${istTime}.`;

    // --- MULTI-MESSAGE CHUNKING ---
    systemPrompt += `\n\n[FORMATTING & LOGIC]
Humans send short, clear text messages on WhatsApp. Break your response into 1 to 3 short, readable text messages. Separate each message using exactly "|||".
Example: "Namaste! Hamari service me aapka swagat hai. ||| Main aapki kya sahayata kar sakta hoon?"
CRITICAL: Read ${targetCustomerName}'s last message carefully and reply directly to what they are asking. Make total sense and keep sentences simple. Do NOT output raw formatting code or weird symbols except "|||".`;

    const messagesForAI = [
      { role: 'system', content: systemPrompt }
    ];

    // Add history (Clean any residual system tags so LLM sees 100% pure human conversation)
    for (const msg of recentMessages) {
      let cleanContent = (msg.content || '')
        .replace(/\[SAVE_FACT:\s*[^\]]+\]/gi, '')
        .replace(/\[CREATE_BOOKING:\s*[^\]]+\]/gi, '')
        .replace(/\[CANCEL_BOOKING\]/gi, '')
        .replace(/\[RESCHEDULE_BOOKING:\s*[^\]]+\]/gi, '')
        .replace(/\[SEND_ASSET:\s*[^\]]+\]/gi, '')
        .trim();

      if (!cleanContent) continue;

      const isMe = (msg.sender === 'bot' || msg.sender === 'agent');
      messagesForAI.push({
        role: isMe ? 'assistant' : 'user',
        content: cleanContent
      });
    }

    // Ensure the last message in messagesForAI has role 'user' (Required by Groq API)
    if (incomingMessage && incomingMessage.trim()) {
      let cleanIncoming = incomingMessage
        .replace(/\[SAVE_FACT:\s*[^\]]+\]/gi, '')
        .replace(/\[CREATE_BOOKING:\s*[^\]]+\]/gi, '')
        .replace(/\[CANCEL_BOOKING\]/gi, '')
        .replace(/\[RESCHEDULE_BOOKING:\s*[^\]]+\]/gi, '')
        .replace(/\[SEND_ASSET:\s*[^\]]+\]/gi, '')
        .trim();

      const lastMsg = messagesForAI[messagesForAI.length - 1];
      if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== cleanIncoming) {
        messagesForAI.push({ role: 'user', content: cleanIncoming });
      }
    }

    // 5. Call Groq API with Exponential Backoff & Model Fallback Strategy
    const startTime = Date.now();
    
    // Ultra-Fast Groq Models in priority order (10x Speed Tier)
    const modelsToTry = [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768'
    ];

    let completion = null;
    let usedModel = modelsToTry[0];

    for (const model of modelsToTry) {
      usedModel = model;
      let attempt = 0;
      let success = false;
      const maxAttempts = 3;

      while (attempt < maxAttempts && !success) {
        try {
          attempt++;
          if (attempt > 1) {
            const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            console.log(`[AI Retry] Retrying model ${model} (Attempt ${attempt}/${maxAttempts}) after ${delayMs}ms delay...`);
            await new Promise(res => setTimeout(res, delayMs));
          }

          completion = await openai.chat.completions.create({
            model: model,
            messages: messagesForAI,
            max_tokens: 150,
            temperature: 0.3,
            frequency_penalty: 0.3,
            presence_penalty: 0.3,
          });

          success = true;
          break;
        } catch (err) {
          const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
          const isServerError = err.status >= 500;

          if ((isRateLimit || isServerError) && attempt < maxAttempts) {
            console.warn(`[AI RateLimit Warning] Model ${model} returned 429/Server error. Retrying attempt ${attempt}...`);
            continue;
          } else {
            console.warn(`[AI Fallback Warning] Model ${model} failed on attempt ${attempt}: ${err.message}. Switching to next fallback model...`);
            break; // Break inner retry loop to try next model in modelsToTry
          }
        }
      }

      if (success && completion) {
        break; // Successfully generated completion
      }
    }

    if (!completion) {
      throw new Error('All AI models and retry attempts failed due to rate limits or API outage.');
    }

    const latencyMs = Date.now() - startTime;
    let aiReply = completion.choices[0].message.content || '';
    aiReply = aiReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Auto-extract [SAVE_FACT: ...] tag and append to customer permanent memory
    const factMatch = aiReply.match(/\[SAVE_FACT:\s*([^\]]+)\]/i);
    if (factMatch && customer) {
      const newFact = factMatch[1].trim();
      aiReply = aiReply.replace(/\[SAVE_FACT:\s*[^\]]+\]/gi, '').trim();
      const existingMemory = customer.memorySummary ? customer.memorySummary + '\n' : '';
      const updatedMemory = existingMemory + `• ${newFact}`;
      try {
        await Customer.findByIdAndUpdate(customer._id, { memorySummary: updatedMemory });
        console.log(`[AI Auto-Memory] Saved new fact for ${customer.name || customer._id}: ${newFact}`);
      } catch (memErr) {
        console.error('[AI Auto-Memory Error]', memErr.message);
      }
    }

    // Auto-extract [UPDATE_MOOD: MOOD_NAME | Sentiment Summary] tag
    const moodMatch = aiReply.match(/\[UPDATE_MOOD:\s*([A-Z_]+)\s*\|\s*([^\]]+)\]/i);
    if (moodMatch && customer) {
      const detectedMood = moodMatch[1].toUpperCase().trim();
      const sentimentSummary = moodMatch[2].trim();
      aiReply = aiReply.replace(/\[UPDATE_MOOD:\s*[^\]]+\]/gi, '').trim();

      const validMoods = ['HAPPY', 'SAD_TIRED', 'ANGRY_UPSET', 'FLIRTY_PLAYFUL', 'STRESSED', 'NEUTRAL'];
      if (validMoods.includes(detectedMood)) {
        try {
          const updatedCust = await Customer.findByIdAndUpdate(customer._id, {
            currentMood: detectedMood,
            detectedSentiment: sentimentSummary,
            lastEmotionUpdate: new Date()
          }, { returnDocument: 'after' });

          console.log(`[Mood-Based Switcher] 🎭 Updated Mood for ${customer.name || customer._id}: ${detectedMood} ("${sentimentSummary}")`);
          
          // Emit real-time mood update to web dashboard
          if (io && customer.tenantId) {
            io.to(customer.tenantId.toString()).emit('customer-updated', updatedCust);
          }
        } catch (moodErr) {
          console.error('[Mood Update Error]', moodErr.message);
        }
      }
    }

    // Log Token Usage & Analytics
    try {
      const UsageLog = require('../models/UsageLog');
      const usage = completion.usage || { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

      const costPer1k = usedModel.includes('70b') ? 0.00059 : 0.0001;
      const estimatedCostUsd = Number(((totalTokens / 1000) * costPer1k).toFixed(6));

      if (tenant?._id || customer?.tenantId) {
        const targetTenantId = tenant ? tenant._id : customer.tenantId;
        await UsageLog.create({
          tenantId: targetTenantId,
          customerId: customer ? customer._id : null,
          model: usedModel,
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCostUsd,
          latencyMs
        });

        // Broadcast real-time analytics update event
        try {
          const { getIo } = require('../config/socket');
          const io = getIo();
          if (io) {
            io.emit('analytics_updated', { tenantId: targetTenantId });
          }
        } catch (sErr) {}
      }
    } catch (logErr) {
      console.error('[AI Service] Failed to log usage stats:', logErr.message);
    }

    return aiReply;

  } catch (error) {
    const errMsg = error.message || 'Unknown error';
    console.error('[AI Service] Error generating response:', errMsg);

    // Record Exact Diagnostic Error Reason in Customer Record for UI Live Tracker Badge
    if (customer && customer._id) {
      try {
        let errorState = 'ERROR_SERVER_OUTAGE';
        let formattedReason = `⚠️ Error: ${errMsg.slice(0, 60)}`;

        if (errMsg.includes('rate limit') || errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('tokens')) {
          errorState = 'ERROR_API_RATE_LIMIT';
          formattedReason = '🚨 Groq AI API Rate Limit / Quota Exceeded (Tokens Exhausted)';
        } else if (errMsg.includes('validation') || errMsg.includes('Mongo') || errMsg.includes('CastError')) {
          errorState = 'ERROR_DB_FAILURE';
          formattedReason = `⚠️ Database Schema Error: ${errMsg.slice(0, 50)}`;
        }

        const updatedCust = await Customer.findByIdAndUpdate(customer._id, {
          aiStatusState: errorState,
          lastResponseReason: formattedReason
        }, { returnDocument: 'after' });

        if (tenant?._id) {
          const { getIo } = require('../config/socket');
          const io = getIo();
          if (io) io.to(tenant._id.toString()).emit('customer-updated', updatedCust);
        }
      } catch (errDb) {
        console.error('[AI Service Error Tracker Save Failed]', errDb.message);
      }
    }

    return null; // Return null so queueManager skips sending dummy fallback text on error
  }
}

/**
 * Phase 25: Analyzes customer message intent and updates their aiTag in the database
 */
async function analyzeIntentAndTag(tenantId, customerId, messageText, io) {
  try {
    const prompt = `You are an AI sales assistant analyzer. Your job is to classify the user's intent based on their message.
Analyze the following message and reply with ONLY ONE of these exact keywords, nothing else:
HOT LEAD (if they are asking about price, buying, or showing high interest)
COMPLAINT (if they are angry, complaining, or unhappy)
SUPPORT (if they need help with a product or service)
SPAM (if it is promotional, irrelevant, or clearly spam)
GENERAL (if it is just a normal greeting or basic question)

Message: "${messageText}"`;

    const completion = await openai.chat.completions.create({
      model: 'groq/compound-mini', // Fast model for quick classification
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 10,
      temperature: 0.1,
    });

    let intent = completion.choices[0].message.content.trim().toUpperCase();
    
    // Clean up the output just in case
    const validTags = ['HOT LEAD', 'COMPLAINT', 'SUPPORT', 'SPAM', 'GENERAL'];
    if (!validTags.includes(intent)) {
      intent = 'GENERAL';
    }

    // Update Customer
    const updatedCustomer = await Customer.findByIdAndUpdate(
      customerId, 
      { aiTag: intent }, 
      { returnDocument: 'after' }
    );

    // Notify frontend to update UI
    if (io && updatedCustomer) {
      io.to(tenantId.toString()).emit('customer-updated', updatedCustomer);
    }

    return intent;
  } catch (error) {
    console.error('[AI Service] Error analyzing intent:', error.message);
    return null;
  }
}

module.exports = {
  generateAIResponse,
  analyzeIntentAndTag
};
