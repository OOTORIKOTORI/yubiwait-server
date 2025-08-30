// routes/adminSettings.js
const express = require('express');
const requireAdmin = require('../middlewares/requireAdmin');
const { validate, z, id24, coerceInt, coerceBool } = require('../middlewares/validate');
const Store = require('../models/Store')

const router = express.Router();

// レスポンス正規化（欠損時の既定値を埋めて返す）
const normalizeStore = (store) => ({
  waitMinutesPerPerson: store?.waitMinutesPerPerson ?? 5,
  notificationTemplate: (store?.notificationTemplate && typeof store.notificationTemplate === 'object')
    ? {
        near:  { title: store.notificationTemplate?.near?.title  || '', body: store.notificationTemplate?.near?.body  || '' },
        ready: { title: store.notificationTemplate?.ready?.title || '', body: store.notificationTemplate?.ready?.body || '' }
      }
    : { near: { title: '', body: '' }, ready: { title: '', body: '' } },
  autoCallerEnabled: typeof store?.autoCallerEnabled === 'boolean' ? store.autoCallerEnabled : true,
  maxServing: store?.maxServing ?? 1,
});

// ========== GET /stores/:storeId/settings ==========
const getStoreSettingsSchema = z.object({
  params: z.object({ storeId: id24 })
});

// 取得
router.get(
  '/stores/:storeId/settings',
  requireAdmin,
  validate(getStoreSettingsSchema),
  async (req, res) => {
    const { storeId } = req.params;

    // 権限チェック（文字列比較で統一）
    if (!req.admin?.storeIds?.map(String).includes(String(storeId))) {
      return res.status(403).json({ error: 'Forbidden: store not allowed' });
    }

    const store = await Store.findById(storeId).lean();
    if (!store) return res.status(404).json({ error: 'Store not found' });

    return res.json(normalizeStore(store));
  }
);

// ========== PATCH /stores/:storeId/settings ==========
const patchStoreSettingsSchema = z.object({
  params: z.object({ storeId: id24 }),
  body: z.object({
    autoCallerEnabled: coerceBool.optional(),
    maxServing: coerceInt(1, 10).optional(),
    waitMinutesPerPerson: coerceInt(1, 60).optional(),
    notificationTemplate: z.object({
      near:  z.object({ title: z.string().max(120).optional(), body: z.string().max(200).optional() }).partial().optional(),
      ready: z.object({ title: z.string().max(120).optional(), body: z.string().max(200).optional() }).partial().optional(),
    }).partial().optional(),
  }).strict()
});

router.patch(
  '/stores/:storeId/settings',
  requireAdmin,
  validate(patchStoreSettingsSchema),
  async (req, res) => {
    const { storeId } = req.params;

    if (!req.admin?.storeIds?.map(String).includes(String(storeId))) {
      return res.status(403).json({ error: 'Forbidden: store not allowed' });
    }

    const { autoCallerEnabled, maxServing, waitMinutesPerPerson, notificationTemplate } = req.body;

    const $set = {};
    if (typeof autoCallerEnabled !== 'undefined') $set.autoCallerEnabled = !!autoCallerEnabled;
    if (typeof maxServing !== 'undefined') $set.maxServing = maxServing; // zodで1..10保証済み
    if (typeof waitMinutesPerPerson !== 'undefined') $set.waitMinutesPerPerson = waitMinutesPerPerson; // 1..60保証済み
    if (notificationTemplate) {
      const near  = notificationTemplate.near  || {};
      const ready = notificationTemplate.ready || {};
      $set.notificationTemplate = {
        near:  { title: near.title   ?? '', body: near.body   ?? '' },
        ready: { title: ready.title  ?? '', body: ready.body  ?? '' },
      };
    }

    const updated = await Store.findByIdAndUpdate(storeId, { $set }, { new: true, lean: true });
    if (!updated) return res.status(404).json({ error: 'Store not found' });

    return res.json(normalizeStore(updated));
  }
);

module.exports = router;
