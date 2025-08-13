// routes/adminSettings.js
const express = require('express');
const mongoose = require('mongoose');
const requireAdmin = require('../middlewares/requireAdmin');

// Storeモデルが既にある想定（なければ最低限のSchemaを追加）
const Store = mongoose.model('Store') || mongoose.model('Store', new mongoose.Schema({
  name: String,
  wait_minutes_per_person: { type: Number, default: 5 },
  notification_template: {
    near: { type: String, default: 'あと{{n}}人でご案内予定です。' },
    ready: { type: String, default: 'まもなくご案内できます。' },
  }
}, { timestamps: true }));

const router = express.Router();

// 取得
router.get('/stores/:storeId/settings', requireAdmin, async (req, res) => {
  const { storeId } = req.params;
  // 権限チェック
  if (!req.admin.storeIds.includes(storeId)) {
    return res.status(403).json({ error: 'Forbidden: store not allowed' });
  }
  const store = await Store.findById(storeId).lean();
  if (!store) return res.status(404).json({ error: 'Store not found' });

  return res.json({
    waitMinutesPerPerson: store.wait_minutes_per_person,
    notificationTemplate: store.notification_template,
  });
});

// 更新
router.patch('/stores/:storeId/settings', requireAdmin, async (req, res) => {
  const { storeId } = req.params;
  const { waitMinutesPerPerson, notificationTemplate } = req.body || {};

  if (!req.admin.storeIds.includes(storeId)) {
    return res.status(403).json({ error: 'Forbidden: store not allowed' });
  }

  const $set = {};
  if (typeof waitMinutesPerPerson === 'number') $set['wait_minutes_per_person'] = waitMinutesPerPerson;
  if (notificationTemplate && typeof notificationTemplate === 'object') {
    $set['notification_template'] = {
      near: notificationTemplate.near || 'あと{{n}}人でご案内予定です。',
      ready: notificationTemplate.ready || 'まもなくご案内できます。',
    };
  }
  const updated = await Store.findByIdAndUpdate(storeId, { $set }, { new: true, lean: true });
  if (!updated) return res.status(404).json({ error: 'Store not found' });

  return res.json({
    waitMinutesPerPerson: updated.wait_minutes_per_person,
    notificationTemplate: updated.notification_template,
  });
});

module.exports = router;
