const express = require('express');
const router = express.Router();
const leadScraperController = require('../controllers/leadScraperController');

// 🔍 Search and Scrape Google Maps Leads
router.post('/search/:tenantId', leadScraperController.searchLeads);

// 📋 Get Saved Leads per tenant
router.get('/tenant/:tenantId', leadScraperController.getSavedLeads);

// 🗑️ Delete lead
router.delete('/:leadId', leadScraperController.deleteLead);

// 🚀 1-Click Import Scraped Leads to Campaign
router.post('/import/:tenantId', leadScraperController.importLeadsToCampaign);

module.exports = router;
