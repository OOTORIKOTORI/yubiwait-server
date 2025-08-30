// routes/adminHistory.js
const express = require('express');
const mongoose = require('mongoose');
const requireAdmin = require('../middlewares/requireAdmin');
const QueueHistory = require('../models/QueueHistory');
const { validate, z, id24, dateOnly, coerceInt } = require('../middlewares/validate');

const router = express.Router();

// params: :storeId, query: from?/to? (YYYY-MM-DD), limit?, offset?
const historySchema = z.object({
  params: z.object({ storeId: id24 }),
  query: z.object({
    from: dateOnly.optional(),
    to:   dateOnly.optional(),
    limit:  coerceInt(1, 200).optional(),
    offset: coerceInt(0, 100000).optional()
  }).partial()
});

function parseRangeJST(query) {
  const { from: fromQ, to: toQ } = query || {};
  const now = new Date();

  const todayJST = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now); // YYYY-MM-DD

  const startDefault = new Date(`${todayJST}T00:00:00+09:00`);
  const from = fromQ ? new Date(`${fromQ}T00:00:00+09:00`) : startDefault;
  const to   = toQ   ? new Date(new Date(`${toQ}T00:00:00+09:00`).getTime() + 24*60*60*1000) : now;

  return { from, to };
}

router.get('/stores/:storeId/history', requireAdmin, validate(historySchema), async (req, res) => {
  const { storeId } = req.params;

  if (!req.admin?.storeIds?.map(String).includes(String(storeId))) {
    return res.status(403).json({ error: 'Forbidden: store not allowed' });
  }

  const limit  = req.query.limit  ?? 50;
  const offset = req.query.offset ?? 0;
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
