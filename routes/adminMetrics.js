// routes/adminMetrics.js
const express = require('express');
const mongoose = require('mongoose');
const requireAdmin = require('../middlewares/requireAdmin');
const QueueHistory = require('../models/QueueHistory');

const router = express.Router();

router.get('/stores/:storeId/metrics', requireAdmin, async (req, res) => {
    const { storeId } = req.params;
    if (!req.admin?.storeIds?.includes(storeId)) {
        return res.status(403).json({ error: 'Forbidden: store not allowed' });
    }

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    // 既定：今日の 00:00 ～ 今
    const now = new Date();
    const startDefault = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const start = from && !isNaN(from) ? from : startDefault;
    const end = to && !isNaN(to) ? to : now;

    const match = {
        store_id: new mongoose.Types.ObjectId(storeId),
        completed_at: { $gte: start, $lt: end }
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
    res.json({ from: start, to: end, count, avgWait, avgService, avgTotal });
});

module.exports = router;
