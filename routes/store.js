// routes/store.js
const express = require('express');
const router = express.Router();

const { signStaff } = require('../utils/jwt');
const Store = require('../models/Store');

// ✅ これまでに合わせて bcryptjs を使用（ネイティブビルド不要で楽）
const bcrypt = require('bcryptjs');

// Zod 入口バリデーション
const { validate, z, id24 } = require('../middlewares/validate');

// ==================== スキーマ ====================

// 店員ログイン
const staffLoginSchema = z.object({
  body: z.object({
    storeId: id24,
    pinCode: z.string().trim().regex(/^\d{4,8}$/, '4〜8桁の数字のみ')
  }).strict()
});

// ==================== ルート ====================

// ✅ 店舗一覧（ドロップダウン用）
router.get('/list', async (req, res) => {
  try {
    const stores = await Store.find({}, '_id name location').sort({ name: 1 }).lean();
    res.json(stores);
  } catch (err) {
    console.error('店舗一覧取得エラー:', err);
    res.status(500).json({ message: '店舗一覧の取得に失敗しました' });
  }
});

// ✅ 店員ログイン（PIN認証）
router.post('/staff-login', validate(staffLoginSchema), async (req, res) => {
  const { storeId, pinCode } = req.body;

  try {
    // name / pinCode のみ取得でOK
    const store = await Store.findById(storeId, { name: 1, pinCode: 1 }).lean();
    if (!store) {
      return res.status(404).json({ message: '店舗が見つかりません' });
    }

    // bcryptjs で照合
    const isMatch = await bcrypt.compare(String(pinCode), String(store.pinCode || ''));
    if (!isMatch) {
      return res.status(401).json({ message: 'PINコードが違います' });
    }

    // JWT発行（既存仕様に合わせて storeId のみペイロード）
    const token = signStaff({ storeId: storeId });

    // 既存フロント互換：message / token / storeName
    res.json({ message: 'ログイン成功', token, storeName: store.name });
  } catch (err) {
    console.error('ログインエラー:', err);
    res.status(500).json({ message: 'ログイン処理失敗' });
  }
});

module.exports = router;
