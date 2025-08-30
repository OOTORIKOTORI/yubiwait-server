// routes/adminAuth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const AdminUser = require('../models/AdminUser');
const { signAdmin } = require('../utils/jwt');
const { validate, z } = require('../middlewares/validate');

const router = express.Router();

// body: { email, password }
const loginSchema = z.object({
  body: z.object({
    email: z.string().email().transform(s => s.trim().toLowerCase()),
    password: z.string().min(1)
  }).strict()
});

router.post('/auth/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const admin = await AdminUser.findOne({ email }).lean();
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, (admin.password_hash || '').trim());
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
