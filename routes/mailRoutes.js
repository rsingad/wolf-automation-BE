const express = require('express');
const router = express.Router();
const mailController = require('../controllers/mailController');

router.post('/single', mailController.sendSingleEmail);
router.post('/broadcast', mailController.sendBroadcastEmail);

module.exports = router;
