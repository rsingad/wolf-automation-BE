const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');

router.get('/settings/:tenantId', tenantController.getSettings);
router.put('/settings/:tenantId', tenantController.updateSettings);
router.post('/topup-coins/:tenantId', tenantController.topupCoins);
router.post('/test-voice', tenantController.testVoiceSample);
router.get('/warmup/:tenantId', tenantController.getWarmupStatus);
router.post('/reward-coins/:tenantId', tenantController.rewardCoins);

module.exports = router;
