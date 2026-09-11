const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { cloudinary } = require('../config/cloudinary');

const voiceDir = path.join(__dirname, '../public/uploads/voice_notes');
if (!fs.existsSync(voiceDir)) {
  fs.mkdirSync(voiceDir, { recursive: true });
}

/**
 * Converts text into natural human spoken voice note (.ogg / Opus) using Microsoft Edge Neural TTS
 * and uploads the resulting audio directly to Cloudinary CDN for instant global streaming.
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

    // 3. Generate Neural MP3 Audio
    await tts.ttsPromise(cleanText, tempMp3Path);

    // 4. Convert MP3 to Opus OGG for WhatsApp Native PTT Waveform
    await new Promise((resolve) => {
      ffmpeg(tempMp3Path)
        .audioCodec('libopus')
        .toFormat('ogg')
        .outputOptions(['-avoid_negative_ts make_zero', '-ac 1', '-ar 16000'])
        .on('end', () => {
          if (fs.existsSync(tempMp3Path)) {
            fs.unlinkSync(tempMp3Path);
          }
          resolve();
        })
        .on('error', (err) => {
          console.error('[TTS Service] FFmpeg conversion warning, using MP3 fallback:', err.message);
          if (fs.existsSync(tempMp3Path)) {
            fs.renameSync(tempMp3Path, finalOggPath);
          }
          resolve();
        })
        .save(finalOggPath);
    });

    // 5. Direct Upload to Cloudinary CDN
    let cloudUrl = null;
    let cloudPublicId = null;

    if (cloudinary && process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const uploadResult = await cloudinary.uploader.upload(finalOggPath, {
          folder: 'wolfai_voice_notes',
          resource_type: 'video', // Cloudinary handles audio under video/raw resource_type
          format: 'ogg'
        });
        cloudUrl = uploadResult.secure_url;
        cloudPublicId = uploadResult.public_id;
        console.log(`[TTS Service] Successfully uploaded voice note to Cloudinary CDN: ${cloudUrl}`);

        // Cleanup local temporary OGG file after uploading to Cloudinary
        if (fs.existsSync(finalOggPath)) {
          fs.unlinkSync(finalOggPath);
        }
      } catch (cloudErr) {
        console.error('[TTS Service] Cloudinary upload error, falling back to local URL:', cloudErr.message);
      }
    }

    const fallbackPublicUrl = `/uploads/voice_notes/${finalOggFilename}`;
    const publicUrl = cloudUrl || fallbackPublicUrl;

    return {
      filePath: finalOggPath,
      filename: finalOggFilename,
      publicUrl: publicUrl,
      cloudUrl: cloudUrl,
      cloudPublicId: cloudPublicId
    };
  } catch (error) {
    console.error('[TTS Service] Error generating Neural voice note:', error.message);
    return null;
  }
}

module.exports = {
  generateVoiceNote
};

