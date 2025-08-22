// routes/adminMetrics.js
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
  }).format(now); // YYYY-MM-DD

  const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  const startDefault = new Date(`${todayJST}T00:00:00+09:00`);
  const from = fromQ
    ? (isDateOnly(fromQ) ? new Date(`${fromQ}T00:00:00+09:00`) : new Date(fromQ))
    : startDefault;

  const to = toQ
    ? (isDateOnly(toQ)
        ? new Date(new Date(`${toQ}T00:00:00+09:00`).getTime() + 24*60*60*1000) // 翌日0時(排他的)
        : new Date(toQ))
    : now;

  return { from, to };
}

router.get('/stores/:storeId/metrics', requireAdmin, async (req, res) => {
  const { storeId } = req.params;
  if (!req.admin?.storeIds?.includes(storeId)) {
    return res.status(403).json({ error: 'Forbidden: store not allowed' });
  }

  const { from, to } = parseRangeJST(req.query);

  const match = {
    store_id: new mongoose.Types.ObjectId(storeId),
    completed_at: { $gte: from, $lt: to }
  };

  const agg = await QueueHistory.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        avgWait: { $avg: '$wait_minutes' },
        avgService: { $avg: '$service_minutes' }
      }
    }
  ]);

  const count = agg[0]?.count || 0;
  const avgWait = agg[0]?.avgWait ? Math.round(agg[0].avgWait * 10) / 10 : 0;
  const avgService = agg[0]?.avgService ? Math.round(agg[0].avgService * 10) / 10 : 0;
  const avgTotal = Math.round((avgWait + avgService) * 10) / 10;

  res.json({ from, to, count, avgWait, avgService, avgTotal });
});

module.exports = router;
