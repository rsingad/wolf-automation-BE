const Campaign = require('../models/Campaign');
const campaignManager = require('../services/whatsapp/campaignManager'); // Background processor

exports.createCampaign = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, template, mediaUrl, safetyMode, customDelayMinSeconds, customDelayMaxSeconds, dripNodes, contacts, batchSplitSize, enableTwoStepShield, autoOptOutFooter } = req.body;

    // Validate
    if (!name || !template || !contacts || contacts.length === 0) {
      return res.status(400).json({ error: 'Missing required fields or contacts' });
    }

    // Default batch size: 200 contacts per campaign batch if total > 250
    const chunkSize = (batchSplitSize && batchSplitSize > 0) ? parseInt(batchSplitSize) : (contacts.length > 250 ? 200 : contacts.length);
    const createdCampaigns = [];

    // Split contacts into chunks
    for (let i = 0; i < contacts.length; i += chunkSize) {
      const chunkContacts = contacts.slice(i, i + chunkSize);
      const batchNum = Math.floor(i / chunkSize) + 1;
      const totalBatches = Math.ceil(contacts.length / chunkSize);
      
      const batchName = totalBatches > 1 ? `${name} (Batch ${batchNum}/${totalBatches})` : name;

      // Check if tenant already has an active running campaign
      const activeRunning = await Campaign.findOne({ tenantId, status: 'running' });
      const initialStatus = (activeRunning || createdCampaigns.length > 0) ? 'pending' : 'running';

      const newCampaign = await Campaign.create({
        tenantId,
        name: batchName,
        template,
        mediaUrl: mediaUrl || '',
        safetyMode: safetyMode || 'safe',
        customDelayMinSeconds: parseInt(customDelayMinSeconds) || 15,
        customDelayMaxSeconds: parseInt(customDelayMaxSeconds) || 40,
        enableTwoStepShield: enableTwoStepShield !== false,
        autoOptOutFooter: autoOptOutFooter !== false,
        batchSplitSize: chunkSize,
        dripNodes: dripNodes || [],
        status: initialStatus,
        contacts: chunkContacts.map(c => ({
          name: c.name || '',
          phone: c.phone,
          status: 'pending'
        })),
        progress: {
          total: chunkContacts.length,
          sent: 0,
          failed: 0,
          ignored: 0
        }
      });

      createdCampaigns.push(newCampaign);
    }

    // Automatically start background processor
    campaignManager.startCampaignProcessor(tenantId);

    res.status(201).json({ 
      success: true, 
      count: createdCampaigns.length, 
      campaign: createdCampaigns[0], 
      campaigns: createdCampaigns 
    });
  } catch (err) {
    console.error('Error creating campaign:', err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
};

exports.getCampaigns = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const campaigns = await Campaign.find({ tenantId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, campaigns });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
};

exports.pauseCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await Campaign.findByIdAndUpdate(campaignId, { status: 'paused' }, { returnDocument: 'after' });
    res.status(200).json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: 'Failed to pause' });
  }
};

exports.resumeCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await Campaign.findByIdAndUpdate(campaignId, { status: 'running', pauseReason: '' }, { returnDocument: 'after' });
    // Trigger processor just in case
    campaignManager.startCampaignProcessor(campaign.tenantId);
    res.status(200).json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resume' });
  }
};

exports.updateCampaignTemplate = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { template, name, safetyMode, customDelayMinSeconds, customDelayMaxSeconds } = req.body;

    const updateFields = {};
    if (template && template.trim()) updateFields.template = template.trim();
    if (name && name.trim()) updateFields.name = name.trim();
    if (safetyMode) updateFields.safetyMode = safetyMode;
    if (customDelayMinSeconds !== undefined) updateFields.customDelayMinSeconds = parseInt(customDelayMinSeconds) || 10;
    if (customDelayMaxSeconds !== undefined) updateFields.customDelayMaxSeconds = parseInt(customDelayMaxSeconds) || 30;

    const campaign = await Campaign.findByIdAndUpdate(campaignId, updateFields, { returnDocument: 'after' });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    console.log(`[Campaign Controller] 📝 Mid-Campaign Settings updated for campaign "${campaign.name}" (${campaign._id})`);
    res.status(200).json({ success: true, message: 'Campaign settings & speed updated successfully!', campaign });
  } catch (err) {
    console.error('Error updating campaign template:', err);
    res.status(500).json({ error: 'Failed to update campaign settings' });
  }
};

exports.retryFailedContacts = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    let retriedCount = 0;
    campaign.contacts.forEach(c => {
      if (c.status === 'failed') {
        c.status = 'pending';
        c.error = '';
        retriedCount++;
      }
    });

    if (retriedCount > 0) {
      campaign.progress.failed = 0;
      const activeRunning = await Campaign.findOne({ tenantId: campaign.tenantId, status: 'running', _id: { $ne: campaign._id } });
      campaign.status = activeRunning ? 'pending' : 'running';
      campaign.pauseReason = '';
      await campaign.save();

      campaignManager.startCampaignProcessor(campaign.tenantId);
    }

    res.status(200).json({ success: true, campaign, retriedCount });
  } catch (err) {
    console.error('Error retrying failed contacts:', err);
    res.status(500).json({ error: 'Failed to retry contacts' });
  }
};
