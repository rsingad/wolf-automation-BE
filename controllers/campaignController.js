const Campaign = require('../models/Campaign');
const campaignManager = require('../services/whatsapp/campaignManager'); // Background processor

exports.createCampaign = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, template, mediaUrl, safetyMode, dripNodes, contacts } = req.body;

    // Validate
    if (!name || !template || !contacts || contacts.length === 0) {
      return res.status(400).json({ error: 'Missing required fields or contacts' });
    }

    // Check if tenant already has an active running campaign
    const activeRunning = await Campaign.findOne({ tenantId, status: 'running' });
    const initialStatus = activeRunning ? 'pending' : 'running';

    const newCampaign = await Campaign.create({
      tenantId,
      name,
      template,
      mediaUrl: mediaUrl || '',
      safetyMode: safetyMode || 'safe',
      dripNodes: dripNodes || [],
      status: initialStatus,
      contacts: contacts.map(c => ({
        name: c.name || '',
        phone: c.phone,
        status: 'pending'
      })),
      progress: {
        total: contacts.length,
        sent: 0,
        failed: 0,
        ignored: 0
      }
    });

    // Automatically start background processor
    campaignManager.startCampaignProcessor(tenantId);

    res.status(201).json({ success: true, campaign: newCampaign });
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
    const campaign = await Campaign.findByIdAndUpdate(campaignId, { status: 'paused' }, { new: true });
    res.status(200).json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: 'Failed to pause' });
  }
};

exports.resumeCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await Campaign.findByIdAndUpdate(campaignId, { status: 'running', pauseReason: '' }, { new: true });
    // Trigger processor just in case
    campaignManager.startCampaignProcessor(campaign.tenantId);
    res.status(200).json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resume' });
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
