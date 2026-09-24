const express = require('express');
const router = express.Router();
const leadScraperController = require('../controllers/leadScraperController');

const scheduledScrapeController = require('../controllers/scheduledScrapeController');

// 🔍 Search and Scrape Google Maps Leads
router.post('/search/:tenantId', leadScraperController.searchLeads);

// 📋 Get Saved Leads per tenant
router.get('/tenant/:tenantId', leadScraperController.getSavedLeads);

// 🗑️ Delete lead & Bulk Delete
router.delete('/:leadId', leadScraperController.deleteLead);
router.post('/delete-bulk', leadScraperController.deleteBulkLeads);

// 🚀 1-Click Import Scraped Leads to Campaign
router.post('/import/:tenantId', leadScraperController.importLeadsToCampaign);

// ⏰ Scheduled Overnight & AI Prompt Scraper Jobs
router.post('/scheduled/:tenantId', scheduledScrapeController.createScheduledJob);
router.get('/scheduled/tenant/:tenantId', scheduledScrapeController.getScheduledJobs);
router.post('/scheduled/run/:jobId', scheduledScrapeController.runJobImmediately);
router.delete('/scheduled/:jobId', scheduledScrapeController.deleteJob);

module.exports = router;
