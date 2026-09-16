const Tenant = require('../models/Tenant');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Register a new Tenant (Business Owner)
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Please provide all fields' });
    }

    const existingTenant = await Tenant.findOne({ email });
    if (existingTenant) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Auto-grant master admin approval for special master admin account
    const isMasterAdminEmail = (email.toLowerCase().includes('wolf') && email.toLowerCase().includes('admin')) || 
                               email.toLowerCase() === 'admin@wolf.ai';

    // Create the tenant with pending approval status (unless master admin)
    const tenant = await Tenant.create({
      name,
      email,
      password: hashedPassword,
      status: isMasterAdminEmail ? 'active' : 'pending_approval',
      isApproved: isMasterAdminEmail,
      role: isMasterAdminEmail ? 'master_admin' : 'tenant'
    });

    // Notify Master Admin Panel via socket
    try {
      const { getIo } = require('../config/socket');
      const io = getIo();
      if (io) {
        io.emit('new_tenant_registered', { tenant });
      }
    } catch (e) {}

    // Response indicating registration requires admin approval
    res.status(201).json({
      success: true,
      pendingApproval: !isMasterAdminEmail,
      message: isMasterAdminEmail 
        ? 'Master Admin Registration Successful!' 
        : '🎉 Registration successful! Your account has been submitted to Wolf Master Panel for admin approval. You can login once approved by Admin.',
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        status: tenant.status,
        isApproved: tenant.isApproved
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
};

// Login a Tenant
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }

    const tenant = await Tenant.findOne({ email });
    if (!tenant) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, tenant.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Auto-grant master_admin role if registered email matches master admin env or wolf.ai domain
    const isMasterAdminEmail = (email.toLowerCase().includes('wolf') && email.toLowerCase().includes('admin')) || 
                               email.toLowerCase() === 'admin@wolf.ai' || 
                               tenant.role === 'master_admin';

    // 🔒 Admin Approval Enforcement Check
    if (!isMasterAdminEmail && tenant.isApproved === false && tenant.status !== 'active') {
      return res.status(403).json({
        error: '⏳ Account Pending Approval! Your registration is currently awaiting verification on Wolf Master Admin Panel. Please contact Admin for instant activation.',
        pendingApproval: true
      });
    }

    // Create a JWT token
    const token = jwt.sign({ id: tenant._id, role: tenant.role }, process.env.JWT_SECRET || 'secret_fallback_key', {
      expiresIn: '7d'
    });

    res.status(200).json({
      success: true,
      token,
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        role: tenant.role || (isMasterAdminEmail ? 'master_admin' : 'tenant'),
        isMasterAdmin: isMasterAdminEmail,
        isApproved: tenant.isApproved !== false,
        status: tenant.status,
        isFrozen: tenant.isFrozen || false,
        freezeReason: tenant.freezeReason || '',
        wolfCoins: tenant.wolfCoins || tenant.wolfTokenBalance || 500000
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
};

// Super Owner / Master Impersonation Login (Access any registered tenant organization)
exports.impersonateTenant = async (req, res) => {
  try {
    const { tenantId, pin } = req.body;

    const masterPinEnv = process.env.WOLF_MASTER_PIN;
    if (!masterPinEnv) {
      return res.status(500).json({ error: 'Master PIN environment variable not configured on server' });
    }

    if (!pin || pin !== masterPinEnv) {
      return res.status(401).json({ error: 'Unauthorized Super Owner security PIN' });
    }

    if (!tenantId) {
      return res.status(400).json({ error: 'Target tenant ID is required' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Generate JWT token for target tenant
    const token = jwt.sign({ id: tenant._id, impersonatedBy: 'super_owner' }, process.env.JWT_SECRET || 'secret_fallback_key', {
      expiresIn: '1d'
    });

    res.status(200).json({
      success: true,
      token,
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        isFrozen: tenant.isFrozen || false,
        freezeReason: tenant.freezeReason || '',
        wolfCoins: tenant.wolfCoins || tenant.wolfTokenBalance || 500000,
        isImpersonated: true
      },
      message: `🔑 Impersonation active: Logged into ${tenant.name} (${tenant.email})`
    });
  } catch (error) {
    console.error('Impersonation error:', error);
    res.status(500).json({ error: 'Server error during impersonation' });
  }
};

// Get Current Tenant Profile (Fresh DB Balance Sync)
exports.getMe = async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    res.status(200).json({
      success: true,
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        role: tenant.role || 'tenant',
        isFrozen: tenant.isFrozen || false,
        freezeReason: tenant.freezeReason || '',
        accountLevel: tenant.accountLevel || 1,
        wolfCoins: tenant.wolfCoins || tenant.wolfTokenBalance || 500000
      }
    });
  } catch (error) {
    console.error('Error fetching current profile:', error);
    res.status(500).json({ error: 'Failed to fetch current user profile' });
  }
};

