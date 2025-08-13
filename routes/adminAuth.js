// routes/adminAuth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const AdminUser = require('../models/AdminUser');
const { signAdmin } = require('../utils/jwt');

const router = express.Router();

/**
 * POST /api/admin/auth/login
 * body: { email, password }
 * resp: { token, admin: { email, role, storeIds } }
 */
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const emailNorm = String(email || '').trim().toLowerCase();
  const admin = await AdminUser.findOne({ email: emailNorm }).lean();

  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

  const pass = String(password || '');
  console.log('[adminAuth] try', { email, passLen: pass.length, hashLen: (admin.password_hash || '').length, hashHead: admin.password_hash?.slice(0, 4) });
  const ok = await bcrypt.compare(pass, (admin.password_hash || '').trim());
  console.log('[adminAuth] result', ok);

  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const payload = {
    adminId: admin._id.toString(),
    email: admin.email,
    role: admin.role,
    storeIds: (admin.store_ids || []).map(id => id.toString()),
  };

  const token = signAdmin(payload);
  return res.json({
    token,
    admin: { email: admin.email, role: admin.role, storeIds: payload.storeIds },
  });
});

module.exports = router;
