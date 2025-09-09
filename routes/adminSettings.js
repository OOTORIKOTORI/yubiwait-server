// routes/adminSettings.js
const express = require('express');
const requireAdmin = require('../middlewares/requireAdmin');
const { validate, z, id24, coerceInt, coerceBool } = require('../middlewares/validate');
const Store = require('../models/Store');
const autoCaller = require('../autoCaller');

const router = express.Router();

// レスポンス正規化（欠損時の既定値を埋めて返す）
const normalizeStore = (store) => ({
  waitMinutesPerPerson: store?.waitMinutesPerPerson ?? 5,
  notificationTemplate:
    (store?.notificationTemplate && typeof store.notificationTemplate === 'object')
      ? {
          near:  { title: store.notificationTemplate?.near?.title  || '', body: store.notificationTemplate?.near?.body  || '' },
          ready: { title: store.notificationTemplate?.ready?.title || '', body: store.notificationTemplate?.ready?.body || '' }
        }
      : { near: { title: '', body: '' }, ready: { title: '', body: '' } },
  autoCallerEnabled: typeof store?.autoCallerEnabled === 'boolean' ? store.autoCallerEnabled : true,
  maxServing: store?.maxServing ?? 1,
});

// ---------- GET /stores/:storeId/settings ----------
const getStoreSettingsSchema = z.object({
  params: z.object({ storeId: id24 })
});

router.get(
  '/stores/:storeId/settings',
  requireAdmin,
  validate(getStoreSettingsSchema),
  async (req, res) => {
    const { storeId } = req.params;
    if (!req.admin?.storeIds?.map(String).includes(String(storeId))) {
      return res.status(403).json({ error: 'Forbidden: store not allowed' });
    }
    const store = await Store.findById(storeId).lean();
    if (!store) return res.status(404).json({ error: 'Store not found' });
    return res.json(normalizeStore(store));
  }
);

// ---------- PATCH /stores/:storeId/settings ----------
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

    const b = req.body || {};
    const normTpl = (v) => (typeof v === 'string'
      ? { title: '', body: v }
      : { title: v?.title || '', body: v?.body || '' });

    // 既存値を読み、指定があったキーだけ差し替える
    const current = await Store.findById(storeId).lean();
    if (!current) return res.status(404).json({ error: 'Store not found' });

    const update = {};
    if (b.autoCallerEnabled != null)      update.autoCallerEnabled      = !!b.autoCallerEnabled;
    if (b.maxServing != null)             update.maxServing             = Math.max(1, Math.min(10, parseInt(b.maxServing, 10) || 1));
    if (b.waitMinutesPerPerson != null)   update.waitMinutesPerPerson   = Math.max(1, Math.min(60, parseInt(b.waitMinutesPerPerson, 10) || 5));
    if (b.notificationTemplate) {
      const currTpl = current.notificationTemplate || {};
      update.notificationTemplate = {
        near:  (b.notificationTemplate.near  != null) ? normTpl(b.notificationTemplate.near)  : (currTpl.near  || { title: '', body: '' }),
        ready: (b.notificationTemplate.ready != null) ? normTpl(b.notificationTemplate.ready) : (currTpl.ready || { title: '', body: '' }),
      };
    }

    // 保存
    const saved = await Store.findByIdAndUpdate(storeId, update, { new: true });

    // 保存直後の即時トリガ（存在するAPIを柔軟に利用）
    try {
      if (saved?.autoCallerEnabled) {
        if (typeof autoCaller.runOnce === 'function') {
          autoCaller.runOnce();
        } else if (typeof autoCaller.triggerForStore === 'function') {
          autoCaller.triggerForStore(String(saved._id));
        } else if (typeof autoCaller.pokeStore === 'function') {
          autoCaller.pokeStore(String(saved._id));
        }
      }
    } catch (e) {
      req.log?.warn?.({ err: e }, 'AutoCaller trigger failed');
    }

    return res.json(normalizeStore(saved));
  }
);

module.exports = router;
