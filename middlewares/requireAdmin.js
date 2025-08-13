// middleware/requireAdmin.js
const { verifyAdmin } = require('../utils/jwt');

module.exports = function requireAdmin(req, res, next) {
  // Authorization: Bearer <token> か x-admin-auth のどちらか
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.headers['x-admin-auth'] || '').toString();

  if (!token) return res.status(401).json({ error: 'Admin token required' });

  try {
    const decoded = verifyAdmin(token);
    req.admin = decoded; // { adminId, storeIds, role, email }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }
};
