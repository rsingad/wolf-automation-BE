const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

router.get('/:tenantId', dashboardController.getDashboardStats);

module.exports = router;
