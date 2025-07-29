const express = require('express')
const jwt = require('jsonwebtoken')
const Store = require('../models/Store') // ← 事前にStoreモデルが必要
const bcrypt = require('bcrypt') // ← ここを追記！
const router = express.Router()

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key'

// ✅ 店舗一覧を取得（ドロップダウン用）
router.get('/list', async (req, res) => {
  try {
    const stores = await Store.find({}, '_id name location').sort({ name: 1 })
    res.json(stores)
  } catch (err) {
    console.error('店舗一覧取得エラー:', err)
    res.status(500).json({ message: '店舗一覧の取得に失敗しました' })
  }
})

// 店員ログイン（PIN認証）
router.post('/login', async (req, res) => {
  const { storeId, pinCode } = req.body

  try {
    const store = await Store.findOne({ _id: storeId })

    if (!store) {
      return res.status(404).json({ message: '店舗が見つかりません' })
    }

    const isMatch = await bcrypt.compare(pinCode, store.pinCode)
    if (!isMatch) {
      return res.status(401).json({ message: 'PINコードが違います' })
    }

    // ✅ JWT発行
    const token = jwt.sign({ storeId: store._id }, JWT_SECRET, { expiresIn: '2h' })
    res.json({ message: 'ログイン成功', token, storeName: store.name })
  } catch (err) {
    console.error('ログインエラー:', err)
    res.status(500).json({ message: 'ログイン処理失敗' })
  }
})

module.exports = router