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

    // Create the tenant
    const tenant = await Tenant.create({
      name,
      email,
      password: hashedPassword
    });

    // Create a JWT token
    const token = jwt.sign({ id: tenant._id }, process.env.JWT_SECRET || 'secret_fallback_key', {
      expiresIn: '7d'
    });

    res.status(201).json({
      success: true,
      token,
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        wolfCoins: tenant.wolfCoins || tenant.wolfTokenBalance || 500000
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

    // Verify password
    const isMatch = await bcrypt.compare(password, tenant.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: tenant._id }, process.env.JWT_SECRET || 'secret_fallback_key', {
      expiresIn: '7d'
    });

    res.status(200).json({
      success: true,
      token,
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        wolfCoins: tenant.wolfCoins || tenant.wolfTokenBalance || 500000
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
};
