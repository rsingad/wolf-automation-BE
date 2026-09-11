const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');

router.post('/create/:tenantId', campaignController.createCampaign);
router.get('/list/:tenantId', campaignController.getCampaigns);
router.put('/pause/:campaignId', campaignController.pauseCampaign);
router.put('/resume/:campaignId', campaignController.resumeCampaign);

module.exports = router;
