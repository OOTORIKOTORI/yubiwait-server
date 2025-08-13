// routes/adminPin.js
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // 生成側は bcryptjs でOK（検証側が bcrypt でも互換）
const requireAdmin = require('../middlewares/requireAdmin');

const Store = mongoose.models.Store || mongoose.model('Store');

const router = express.Router();

/**
 * POST /api/admin/stores/:storeId/reset-pin
 * body: { newPin: "1234" }
 */
router.post('/stores/:storeId/reset-pin', requireAdmin, async (req, res) => {
  const { storeId } = req.params;
  const { newPin } = req.body || {};

  // 権限チェック
  if (!req.admin?.storeIds?.includes(storeId)) {
    return res.status(403).json({ error: 'Forbidden: store not allowed' });
  }

  // 超シンプルなバリデーション（必要なら強化）
  if (!newPin || !/^\d{4,8}$/.test(String(newPin))) {
    return res.status(400).json({ error: 'PINは4〜8桁の数字で入力してください' });
  }

  // ハッシュ化して保存（Store.pinCode を更新）
  const hash = await bcrypt.hash(String(newPin), 10);
  const updated = await Store.findByIdAndUpdate(
    storeId,
    { $set: { pinCode: hash } },
    { new: true, lean: true }
  );
  if (!updated) return res.status(404).json({ error: 'Store not found' });

  // 監査向けに最小限のレスポンス
  return res.json({ ok: true });
});

module.exports = router;
