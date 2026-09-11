const express = require('express');
const router = express.Router();
const { uploadCloud } = require('../config/cloudinary');

// POST /api/upload - Single Media File Upload to Cloudinary CDN
router.post('/', uploadCloud.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // req.file.path contains the secure Cloudinary HTTPS CDN URL
    return res.json({
      success: true,
      url: req.file.path,
      publicId: req.file.filename,
      originalName: req.file.originalname,
      message: 'File uploaded successfully to Cloudinary CDN'
    });
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
