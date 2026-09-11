const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary credentials from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer storage to stream files directly to Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'wolfai_campaign_media',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'mp4'],
    resource_type: 'auto'
  }
});

const uploadCloud = multer({ 
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max file size
});

module.exports = {
  cloudinary,
  uploadCloud
};
