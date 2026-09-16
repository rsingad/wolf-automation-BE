const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/impersonate', authController.impersonateTenant);
router.get('/me/:tenantId', authController.getMe);

module.exports = router;
