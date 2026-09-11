const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const voiceDir = path.join(__dirname, '../public/uploads/voice_notes');
if (!fs.existsSync(voiceDir)) {
  fs.mkdirSync(voiceDir, { recursive: true });
}

/**
 * Converts text into natural human spoken voice note (.ogg / Opus) using Microsoft Edge Neural TTS.
 * @param {string} text Raw text to speak
 * @param {string} lang Language code ('hi', 'en')
 * @param {string} gender Voice gender ('male' | 'female')
 */
async function generateVoiceNote(text, lang = 'hi', gender = 'female', customActor = null, customRate = '+0%') {
  try {
    // 1. Clean markdown, asset tags, special characters, and repetitive dots
    let cleanText = text
      .replace(/\[SEND_ASSET:\s*[^\]]+\]/gi, '')
      .replace(/\[CREATE_BOOKING:\s*[^\]]+\]/gi, '')
      .replace(/\|\|\|/g, ', ')
      .replace(/[*_~`#\-\.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return null;

    // 2. Select Microsoft Edge Neural Voice Model
    // Supported actors: 'hi-IN-SwaraNeural', 'hi-IN-MadhurNeural', 'en-IN-NeerjaNeural', 'en-IN-PrabhatNeural', 'en-US-JennyNeural', 'en-US-GuyNeural'
    let voiceModel = customActor;
    if (!voiceModel) {
      voiceModel = gender === 'male' ? 'hi-IN-MadhurNeural' : 'hi-IN-SwaraNeural';
    }

    const tts = new EdgeTTS({
      voice: voiceModel,
      rate: customRate || '+0%',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });

    const timestamp = Date.now();
    const tempMp3Path = path.join(voiceDir, `temp_${timestamp}.mp3`);
    const finalOggFilename = `voice_${timestamp}.ogg`;
    const finalOggPath = path.join(voiceDir, finalOggFilename);

    // 4. Generate Neural MP3 Audio using ttsPromise
    await tts.ttsPromise(cleanText, tempMp3Path);

    // 5. Convert MP3 to Opus OGG for WhatsApp Native PTT Waveform using fluent-ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempMp3Path)
        .audioCodec('libopus')
        .toFormat('ogg')
        .outputOptions(['-avoid_negative_ts make_zero', '-ac 1', '-ar 16000'])
        .on('end', () => {
          // Clean temporary MP3
          if (fs.existsSync(tempMp3Path)) {
            fs.unlinkSync(tempMp3Path);
          }
          resolve();
        })
        .on('error', (err) => {
          console.error('[TTS Service] FFmpeg conversion error:', err);
          // Fallback to MP3 if opus encoder fails
          if (fs.existsSync(tempMp3Path)) {
            fs.renameSync(tempMp3Path, finalOggPath);
          }
          resolve();
        })
        .save(finalOggPath);
    });

    console.log(`[TTS Service] Generated Natural Neural Voice Note: ${finalOggFilename} using ${voiceModel}`);

    return {
      filePath: finalOggPath,
      filename: finalOggFilename,
      publicUrl: `/uploads/voice_notes/${finalOggFilename}`
    };
  } catch (error) {
    console.error('[TTS Service] Error generating Neural voice note:', error.message);
    return null;
  }
}

module.exports = {
  generateVoiceNote
};
