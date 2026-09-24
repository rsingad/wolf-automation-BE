const OpenAI = require('openai');

/**
 * AI Lead Research Prompt Engine
 * Uses Groq / OpenAI to automatically generate 10x deep-research targeted sub-keywords & sub-industries
 */
exports.generateAIKeywords = async (promptInput, targetCity = 'Jaipur') => {
  console.log(`[AI Scraper Engine] Generating 10x target keywords for prompt: "${promptInput}" in "${targetCity}"`);

  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;

  if (apiKey) {
    try {
      const client = new OpenAI({
        apiKey: apiKey,
        baseURL: process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined
      });

      const response = await client.chat.completions.create({
        model: process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert B2B Lead Generation & Market Research Strategist. 
Given a target audience goal or prompt from a user, break it down into 8 to 12 precise, highly relevant Google Maps search queries/keywords for local business extraction in ${targetCity}.
Return ONLY a raw JSON array of string keywords without markdown formatting or commentary. Example: ["CrossFit Gyms", "Personal Training Studios", "Pilates Centers", "Women Fitness Clubs"]`
          },
          {
            role: 'user',
            content: `Goal / Target Audience: "${promptInput}" in city "${targetCity}"`
          }
        ],
        temperature: 0.6
      });

      const rawText = response.choices[0]?.message?.content || '[]';
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedKeywords = JSON.parse(cleanJson);

      if (Array.isArray(parsedKeywords) && parsedKeywords.length > 0) {
        return parsedKeywords;
      }
    } catch (err) {
      console.warn(`[AI Scraper Engine Error]: ${err.message}. Falling back to rule-based keyword generator...`);
    }
  }

  // Fallback intelligent keyword expansion if no AI key configured
  const baseWords = promptInput.split(/,|\sand\s/i).map(w => w.trim()).filter(Boolean);
  const expanded = [];

  baseWords.forEach(word => {
    expanded.push(word);
    expanded.push(`Top ${word}`);
    expanded.push(`Best ${word} Center`);
    expanded.push(`Luxury ${word}`);
    expanded.push(`B2B ${word} Suppliers`);
  });

  return expanded.slice(0, 10);
};
