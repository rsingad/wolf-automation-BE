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

    const newCampaign = await Campaign.create({
      tenantId,
      name,
      template,
      mediaUrl: mediaUrl || '',
      safetyMode: safetyMode || 'safe',
      dripNodes: dripNodes || [],
      status: 'running',
      contacts: contacts.map(c => ({
        name: c.name || '',
        phone: c.phone,
        status: 'pending'
      })),
      progress: {
        total: contacts.length,
        sent: 0,
        failed: 0
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
    const campaign = await Campaign.findByIdAndUpdate(campaignId, { status: 'running' }, { new: true });
    // Trigger processor just in case
    campaignManager.startCampaignProcessor(campaign.tenantId);
    res.status(200).json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resume' });
  }
};
