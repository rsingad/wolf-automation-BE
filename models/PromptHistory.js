const mongoose = require('mongoose');

const promptHistorySchema = new mongoose.Schema({
  tenantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true,
    index: true 
  },
  type: { 
    type: String, 
    enum: ['botPrompt', 'knowledgeBaseText'], 
    required: true 
  },
  title: { 
    type: String, 
    default: '' 
  },
  content: { 
    type: String, 
    required: true 
  },
  charCount: { 
    type: Number, 
    default: 0 
  },
  isActive: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

module.exports = mongoose.model('PromptHistory', promptHistorySchema);
