const SavedLead = require('../models/SavedLead');
const { scrapeGoogleMapsLeads } = require('../services/googleMapsScraperService');

// 🔍 Search and Scrape Google Maps Leads
exports.searchLeads = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { query, city, engine = 'playwright' } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Search query is required (e.g. "Gyms", "Real Estate")' });
    }

    const leads = await scrapeGoogleMapsLeads(query.trim(), city ? city.trim() : '', engine);
    
    // Auto-save scraped leads to database under tenant
    // Fetch existing saved leads for tenant to auto-append new scraped leads
    const savedDocs = [];
    for (const item of leads) {
      const existing = await SavedLead.findOne({ tenantId, businessName: item.businessName });
      if (!existing) {
        const doc = await SavedLead.create({
          tenantId,
          query: query.trim(),
          businessName: item.businessName,
          phone: item.phone,
          address: item.address,
          rating: item.rating,
          userRatingsTotal: item.userRatingsTotal,
          website: item.website,
          email: item.email || '',
          description: item.description || '',
          socialLinks: item.socialLinks || {},
          category: item.category,
          engineChoice: engine,
          extraInfo: item.extraInfo || `Scraped via ${engine} for query "${query.trim()}" in ${city || 'Local Region'}`,
          status: 'new'
        });
        savedDocs.push(doc);
      } else {
        savedDocs.push(existing);
      }
    }

    // Always fetch all saved leads for tenant sorted newest first so table updates instantly
    const allTenantLeads = await SavedLead.find({ tenantId }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: savedDocs.length,
      query: query.trim(),
      leads: allTenantLeads
    });
  } catch (err) {
    console.error('Error searching leads:', err);
    res.status(500).json({ error: 'Failed to scrape business leads' });
  }
};

// 📋 Get all saved leads for tenant
exports.getSavedLeads = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const leads = await SavedLead.find({ tenantId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: leads.length, leads });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch saved leads' });
  }
};

// 🗑️ Delete single lead
exports.deleteLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    await SavedLead.findByIdAndDelete(leadId);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete lead' });
  }
};

// 🗑️ Bulk Delete Selected Leads
exports.deleteBulkLeads = async (req, res) => {
  try {
    const { leadIds } = req.body;
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'Select at least 1 lead to delete' });
    }
    await SavedLead.deleteMany({ _id: { $in: leadIds } });
    res.status(200).json({ success: true, message: `Successfully deleted ${leadIds.length} leads` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to bulk delete leads' });
  }
};

// 🚀 1-Click Import Scraped Leads into WhatsApp Campaign Contacts
exports.importLeadsToCampaign = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { leadIds, campaignName } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'Select at least 1 lead to import' });
    }

    const leads = await SavedLead.find({ tenantId, _id: { $in: leadIds } });
    if (leads.length === 0) {
      return res.status(404).json({ error: 'No valid leads found to import' });
    }

    // Format into Campaign contacts format [{ name, phone }]
    const campaignContacts = leads.map(l => ({
      name: l.businessName,
      phone: l.phone
    }));

    // Mark imported status in SavedLeads
    await SavedLead.updateMany(
      { _id: { $in: leadIds } },
      { $set: { status: 'imported' } }
    );

    res.status(200).json({
      success: true,
      count: campaignContacts.length,
      contacts: campaignContacts,
      message: `Successfully prepared ${campaignContacts.length} business leads for WhatsApp Broadcast!`
    });
  } catch (err) {
    console.error('Error importing leads to campaign:', err);
    res.status(500).json({ error: 'Failed to import leads to campaign' });
  }
};
