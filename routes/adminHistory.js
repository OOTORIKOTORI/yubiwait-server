// routes/adminHistory.js
const express = require('express');
const mongoose = require('mongoose');
const requireAdmin = require('../middlewares/requireAdmin');
const QueueHistory = require('../models/QueueHistory');

const router = express.Router();

router.get('/stores/:storeId/history', requireAdmin, async (req, res) => {
  const { storeId } = req.params;
  if (!req.admin?.storeIds?.includes(storeId)) {
    return res.status(403).json({ error: 'Forbidden: store not allowed' });
  }

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  const q = { store_id: new mongoose.Types.ObjectId(storeId) };
  const cursor = QueueHistory.find(q)
    .sort({ completed_at: -1 })
    .skip(offset)
    .limit(limit)
    .lean();

  const items = await cursor;
  res.json({ items, limit, offset });
});

module.exports = router;
