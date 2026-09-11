const MediaAsset = require('../models/MediaAsset');
const fs = require('fs');
const path = require('path');

exports.uploadAsset = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { keyword } = req.body;

    if (!req.file || !keyword) {
      return res.status(400).json({ error: 'File and keyword are required' });
    }

    const newAsset = await MediaAsset.create({
      tenantId,
      keyword: keyword.toUpperCase(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    res.status(201).json({ success: true, asset: newAsset });
  } catch (error) {
    console.error('Error uploading asset:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAssets = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const assets = await MediaAsset.find({ tenantId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, assets });
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteAsset = async (req, res) => {
  try {
    const { assetId } = req.params;
    const asset = await MediaAsset.findById(assetId);
    
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Delete file
    const filePath = path.join(__dirname, '..', 'public', 'uploads', asset.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await MediaAsset.findByIdAndDelete(assetId);

    res.status(200).json({ success: true, message: 'Asset deleted' });
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
