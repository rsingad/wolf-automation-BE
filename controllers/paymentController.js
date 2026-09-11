const Payment = require('../models/Payment');
const Tenant = require('../models/Tenant');

// Get All Payment History for Tenant (User View)
exports.getPaymentHistory = async (req, res) => {
  try {
    const { tenantId } = req.params;
    let targetTenantId = tenantId;

    if (!targetTenantId || targetTenantId === 'undefined') {
      const defaultTenant = await Tenant.findOne();
      if (defaultTenant) {
        targetTenantId = defaultTenant._id;
      }
    }

    if (!targetTenantId) {
      return res.status(200).json({
        success: true,
        payments: [],
        summary: { totalSpentInr: 0, totalCoinsPurchased: 0, totalTransactions: 0 }
      });
    }

    const payments = await Payment.find({ tenantId: targetTenantId }).sort({ createdAt: -1 });

    const approvedPayments = payments.filter(p => p.status === 'approved');
    const totalSpentInr = approvedPayments.reduce((sum, item) => sum + (item.amountPaidInr || 0), 0);
    const totalCoinsPurchased = approvedPayments.reduce((sum, item) => sum + (item.coinsAllocated || 0), 0);

    res.status(200).json({
      success: true,
      payments,
      summary: {
        totalSpentInr,
        totalCoinsPurchased,
        totalTransactions: approvedPayments.length
      }
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
};

// Admin: Get All Payments across all tenants
exports.getAllPaymentsAdmin = async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('tenantId', 'name email whatsappNumber')
      .sort({ createdAt: -1 });

    const pendingCount = payments.filter(p => p.status === 'pending').length;
    const approvedCount = payments.filter(p => p.status === 'approved').length;
    const rejectedCount = payments.filter(p => p.status === 'rejected').length;

    res.status(200).json({
      success: true,
      payments,
      summary: {
        total: payments.length,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount
      }
    });
  } catch (error) {
    console.error('Error fetching admin payments:', error);
    res.status(500).json({ error: 'Failed to fetch admin payment requests' });
  }
};

// Admin: Approve Payment Request & Credit Wolf Coins
exports.approvePaymentAdmin = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await Payment.findById(paymentId);

    if (!payment) {
      return res.status(404).json({ error: 'Payment request not found' });
    }

    if (payment.status === 'approved') {
      return res.status(400).json({ error: 'Payment has already been approved' });
    }

    // Mark Payment Approved
    payment.status = 'approved';
    payment.verifiedAt = new Date();
    await payment.save();

    // Credit Wolf Coins to Tenant
    const tenant = await Tenant.findById(payment.tenantId);
    if (tenant) {
      const currentBase = (tenant.wolfCoins > 0 ? tenant.wolfCoins : (tenant.wolfTokenBalance > 0 ? tenant.wolfTokenBalance : 500000));
      const newTotal = currentBase + payment.coinsAllocated;
      tenant.wolfCoins = newTotal;
      tenant.wolfTokenBalance = newTotal;
      tenant.totalWolfTokensAllocated = (tenant.totalWolfTokensAllocated || 500000) + payment.coinsAllocated;
      await tenant.save();
    }

    // Broadcast Real-Time Socket Updates
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('analytics_updated', { tenantId: payment.tenantId });
        io.emit('payment_updated', { tenantId: payment.tenantId, paymentId: payment._id, status: 'approved' });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      message: `🎉 Payment approved! ${payment.coinsAllocated.toLocaleString('en-IN')} Wolf Coins credited to tenant.`,
      payment,
      tenantNewBalance: tenant?.wolfTokenBalance
    });
  } catch (error) {
    console.error('Error approving payment:', error);
    res.status(500).json({ error: 'Failed to approve payment' });
  }
};

// Admin: Reject Payment Request
exports.rejectPaymentAdmin = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { rejectionReason } = req.body;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      return res.status(404).json({ error: 'Payment request not found' });
    }

    if (payment.status === 'approved') {
      return res.status(400).json({ error: 'Approved payment cannot be rejected' });
    }

    payment.status = 'rejected';
    payment.rejectionReason = rejectionReason || 'Invalid UTR or payment not received.';
    payment.verifiedAt = new Date();
    await payment.save();

    // Broadcast Real-Time Socket Updates
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('payment_updated', { tenantId: payment.tenantId, paymentId: payment._id, status: 'rejected' });
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      message: '❌ Payment request rejected.',
      payment
    });
  } catch (error) {
    console.error('Error rejecting payment:', error);
    res.status(500).json({ error: 'Failed to reject payment' });
  }
};
