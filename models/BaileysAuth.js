const mongoose = require('mongoose');

const baileysAuthSchema = new mongoose.Schema({
  tenantId: { type: String, required: true },
  keyId: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

baileysAuthSchema.index({ tenantId: 1, keyId: 1 }, { unique: true });

module.exports = mongoose.model('BaileysAuth', baileysAuthSchema);
