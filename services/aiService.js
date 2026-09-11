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
    
    // 2. Fetch Customer specifics
    const customer = await Customer.findById(customerId);
    
    // If AI is paused for this customer, return null so we don't reply
    if (customer && customer.aiPaused) {
      console.log(`[AI] Skipped replying to customer ${customerId} because AI is paused.`);
      return null;
    }

    // 3. Fetch recent chat history (last 40 messages for context)
    const recentMessages = await Message.find({ tenantId, customerId })
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();
    
    // Reverse them to chronological order
    recentMessages.reverse();

    // 4. Construct the prompt
    let systemPrompt = `You are a helpful, smart, and polite WhatsApp AI assistant replying to messages on behalf of a business.
UNDER NO CIRCUMSTANCES should you ever reveal that you are an AI, a language model, or a bot. You must perfectly mimic a helpful human customer representative.
Always reply in the same language and tone as the customer (e.g., Hinglish, Hindi, or English). Keep your answers clear, concise, logical, and easy to understand. Never give confusing or nonsensical replies.`;

    if (tenant && tenant.botPrompt) {
      systemPrompt += `\n\n[GLOBAL BUSINESS RULE]\n${tenant.botPrompt}`;
    }

    if (tenant && tenant.knowledgeBaseText) {
      systemPrompt += `\n\n[BUSINESS KNOWLEDGE BASE]\nUse the following information to answer customer queries accurately. If the answer is not here, use your best judgment or politely say you don't know and will check with the team:\n${tenant.knowledgeBaseText}`;
    }

    if (customer && customer.customPrompt) {
      systemPrompt += `\n\n[CRITICAL USER-SPECIFIC OVERRIDE]\nThe following rules are specifically for THIS user. You MUST prioritize these instructions above all other global rules:\n"${customer.customPrompt}"`;
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

    // --- CHRONOLOGICAL CONTEXT ---
    const now = new Date();
    const istTime = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    
    systemPrompt += `\n\n[CONTEXT]
The current time is: ${istTime}.`;

    // --- MULTI-MESSAGE CHUNKING ---
    systemPrompt += `\n\n[FORMATTING & LOGIC]
Humans send short, clear text messages on WhatsApp. Break your response into 1 to 3 short, readable text messages. Separate each message using exactly "|||".
Example: "Namaste! Hamari service me aapka swagat hai. ||| Main aapki kya sahayata kar sakta hoon?"
CRITICAL: Read the user's last message carefully and reply directly to what they are asking. Make total sense and keep sentences simple. Do NOT output raw formatting code or weird symbols except "|||".`;

    const messagesForAI = [
      { role: 'system', content: systemPrompt }
    ];

    // Add history
    for (const msg of recentMessages) {
      messagesForAI.push({
        role: msg.sender === 'bot' || msg.sender === 'agent' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    // Ensure the last message in messagesForAI has role 'user' (Required by Groq API)
    if (incomingMessage && incomingMessage.trim()) {
      const lastMsg = messagesForAI[messagesForAI.length - 1];
      if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== incomingMessage) {
        messagesForAI.push({ role: 'user', content: incomingMessage });
      }
    }

    // 5. Call Groq API with Exponential Backoff & Model Fallback Strategy
    const startTime = Date.now();
    
    // Models in priority order (Primary -> Fallback 1 -> Fallback 2)
    const modelsToTry = [
      'groq/compound-mini',
      'allam-2-7b',
      'qwen/qwen3.6-27b'
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
    console.error('[AI Service] Error generating response:', error.message);
    return "I'm having a bit of trouble right now, please wait while I connect you to a human agent.";
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
