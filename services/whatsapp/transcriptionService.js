const fs = require('fs');
const path = require('path');
const os = require('os');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

/**
 * Transcribes an audio buffer to text using Groq's Whisper API.
 * @param {Buffer} audioBuffer - The downloaded audio buffer from Baileys
 * @returns {Promise<string|null>} The transcribed text
 */
async function transcribeAudio(audioBuffer) {
  if (!audioBuffer) return null;

  // Groq / OpenAI requires a file stream with a known extension.
  // We'll write it to a temporary file, then send it, then delete it.
  const tmpDir = os.tmpdir();
  const tempFilePath = path.join(tmpDir, `wa_audio_${Date.now()}.ogg`);
  
  try {
    fs.writeFileSync(tempFilePath, audioBuffer);
    
    // Call Groq Audio Transcription API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3',
      response_format: 'json',
      language: 'en', // Can be removed for auto-detect or set to 'hi' if mostly Hindi. Let's let it auto-detect.
    });

    return transcription.text;
  } catch (error) {
    console.error('[TranscriptionService] Error transcribing audio:', error);
    return null;
  } finally {
    // Clean up temporary file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

module.exports = {
  transcribeAudio
};
