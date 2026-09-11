const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload dir exists
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

router.post('/upload/:tenantId', upload.single('file'), assetController.uploadAsset);
router.get('/:tenantId', assetController.getAssets);
router.delete('/:assetId', assetController.deleteAsset);

module.exports = router;
