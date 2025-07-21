const express = require('express')
const router = express.Router()
const Customer = require('../models/Customer')
const authenticateStore = require('../middlewares/auth')
// 🔐 ここから先のAPIは認証付き
router.use(authenticateStore)

// 店舗ごとの待機中リストを取得
router.get('/:storeId', async (req, res) => {
  const { storeId } = req.params

  if (storeId !== req.storeId) {
    return res.status(403).json({ message: '店舗が一致しません' })
  }

  try {
    const customers = await Customer.find({ storeId, status: 'waiting' }).sort('joinedAt')
    res.json({ storeId, customers })
  } catch (err) {
    console.error('一覧取得エラー:', err)
    res.status(500).json({ message: '一覧取得失敗' })
  }
})

// ✅ 完了処理
router.patch('/:storeId/done/:customerId', async (req, res) => {
  const { storeId, customerId } = req.params

  if (storeId !== req.storeId) {
    return res.status(403).json({ message: '店舗が一致しません' })
  }

  try {
    const updated = await Customer.findOneAndUpdate(
      { _id: customerId, storeId },
      { status: 'done' },
      { new: true }
    )

    if (!updated) {
      return res.status(404).json({ message: '対象の顧客が見つかりませんでした' })
    }

    res.json({ message: '完了にしました', customer: updated })
  } catch (err) {
    console.error('完了処理エラー:', err)
    res.status(500).json({ message: '完了処理失敗' })
  }
})

module.exports = router
