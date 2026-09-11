const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

router.get('/customers/:tenantId', chatController.getCustomers);
router.get('/customer-detail/:customerId', chatController.getCustomerDetail);
router.get('/messages/:customerId', chatController.getMessages);

// Phase 9: Human-in-the-loop routes
router.post('/send/:tenantId/:customerId', chatController.sendManualMessage);
router.put('/customer/:customerId/pause', chatController.toggleAiPause);
router.put('/pause-all/:tenantId', chatController.toggleAllAiPause);
router.put('/customer/:customerId/prompt', chatController.updateCustomPrompt);
router.post('/customer/:customerId/sync-profile', chatController.syncProfile);

module.exports = router;
