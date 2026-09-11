const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// User payment history
router.get('/history/:tenantId', paymentController.getPaymentHistory);

// Admin routes
router.get('/admin/all', paymentController.getAllPaymentsAdmin);
router.post('/admin/approve/:paymentId', paymentController.approvePaymentAdmin);
router.post('/admin/reject/:paymentId', paymentController.rejectPaymentAdmin);

module.exports = router;
