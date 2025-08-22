// routes/adminHistory.js
const express = require('express');
const mongoose = require('mongoose');
const requireAdmin = require('../middlewares/requireAdmin');
const QueueHistory = require('../models/QueueHistory');

const router = express.Router();

function parseRangeJST(query) {
  const { from: fromQ, to: toQ } = query || {};
  const now = new Date();
  const todayJST = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  const startDefault = new Date(`${todayJST}T00:00:00+09:00`);
  const from = fromQ
    ? (isDateOnly(fromQ) ? new Date(`${fromQ}T00:00:00+09:00`) : new Date(fromQ))
    : startDefault;

  const to = toQ
    ? (isDateOnly(toQ)
        ? new Date(new Date(`${toQ}T00:00:00+09:00`).getTime() + 24*60*60*1000)
        : new Date(toQ))
    : now;

  return { from, to };
}

router.get('/stores/:storeId/history', requireAdmin, async (req, res) => {
  const { storeId } = req.params;
  if (!req.admin?.storeIds?.includes(storeId)) {
    return res.status(403).json({ error: 'Forbidden: store not allowed' });
  }

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  const { from, to } = parseRangeJST(req.query);

  const q = {
    store_id: new mongoose.Types.ObjectId(storeId),
    completed_at: { $gte: from, $lt: to }
  };

  const items = await QueueHistory.find(q)
    .sort({ completed_at: -1 })
    .skip(offset)
    .limit(limit)
    .lean();

  res.json({ from, to, items, limit, offset });
});

module.exports = router;
