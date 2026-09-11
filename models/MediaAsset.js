const mongoose = require('mongoose');

const mediaAssetSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  keyword: { type: String, required: true, uppercase: true }, // e.g. MENU, CATALOG, PRICING
  filename: { type: String, required: true }, // Saved file name in /public/uploads
  originalName: { type: String },
  mimetype: { type: String },
  size: { type: Number },
}, { timestamps: true });

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
