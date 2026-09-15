const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');

router.post('/create/:tenantId', campaignController.createCampaign);
router.get('/list/:tenantId', campaignController.getCampaigns);
router.put('/pause/:campaignId', campaignController.pauseCampaign);
router.put('/resume/:campaignId', campaignController.resumeCampaign);
router.put('/update-template/:campaignId', campaignController.updateCampaignTemplate);
router.put('/retry-failed/:campaignId', campaignController.retryFailedContacts);

module.exports = router;
