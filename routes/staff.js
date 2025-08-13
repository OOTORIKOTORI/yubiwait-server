const express = require('express')
const router = express.Router()
const Customer = require('../models/Customer')
const authenticateStore = require('../middlewares/auth')

// ★ 追加：履歴モデル
const QueueHistory = require('../models/QueueHistory')

// 🔐 ここから先のAPIは認証付き
router.use(authenticateStore)

// 店舗ごとの待機中リストを取得
router.get('/:storeId', async (req, res) => {
  const { storeId } = req.params
  const mode = (req.query.status || 'waiting').toLowerCase()

  if (storeId !== req.storeId) {
    return res.status(403).json({ message: '店舗が一致しません' })
  }

  try {
    if (mode === 'all') {
      // 待機中 + 呼び出し中をそれぞれ返す（UIで分けて表示しやすい）
      const [waiting, serving] = await Promise.all([
        Customer.find({ storeId, status: 'waiting' }).sort('joinedAt'),     // 受付順
        Customer.find({ storeId, status: 'serving' }).sort('calledAt')      // 呼出し順（早い順）
      ])
      return res.json({ storeId, waiting, serving })
    }

    if (mode === 'serving') {
      const serving = await Customer.find({ storeId, status: 'serving' }).sort('calledAt')
      return res.json({ storeId, customers: serving })
    }

    // 既定（従来通り）：waiting のみ
    const customers = await Customer.find({ storeId, status: 'waiting' }).sort('joinedAt')
    return res.json({ storeId, customers })
  } catch (err) {
    console.error('一覧取得エラー:', err)
    res.status(500).json({ message: '一覧取得失敗' })
  }
})

// ✅ 完了処理（履歴保存フック付き：初回のみ記録）
// ✅ 完了処理（calledAt に対応）
router.patch('/:storeId/done/:customerId', async (req, res) => {
  const { storeId, customerId } = req.params
  if (storeId !== req.storeId) return res.status(403).json({ message: '店舗が一致しません' })

  try {
    // 現在の状態を取得
    const customer = await Customer.findOne({ _id: customerId, storeId })
    if (!customer) return res.status(404).json({ message: '対象の顧客が見つかりませんでした' })
    if (customer.status === 'done') return res.json({ message: '既に完了済みです', customer })

    // 時刻を決定
    const now = new Date()
    const joined = customer.joinedAt || customer.createdAt || now
    const called = customer.calledAt || now      // 呼び出し未実施でも壊さない: called=now
    const completed = customer.completedAt || now

    // 状態更新
    customer.status = 'done'
    customer.completedAt = completed
    await customer.save()

    // 分計算（負値は0に丸める）
    const waitMin = Math.max(0, Math.round((called - joined) / 60000))
    const serviceMin = Math.max(0, Math.round((completed - called) / 60000))

    // 履歴保存
    try {
      await QueueHistory.create({
        store_id: storeId,
        customer_name: customer.name || '',
        joined_at: joined,
        completed_at: completed,
        wait_minutes: waitMin,
        service_minutes: serviceMin,
      })
    } catch (e) {
      console.error('[history] save failed:', e)
    }

    res.json({ message: '完了にしました', customer })
  } catch (err) {
    console.error('完了処理エラー:', err)
    res.status(500).json({ message: '完了処理失敗' })
  }
})

// 匿名で受付
router.post('/:storeId/anonymous', async (req, res) => {
  const { storeId } = req.params

  if (storeId !== req.storeId) {
    return res.status(403).json({ message: '店舗が一致しません' })
  }

  try {
    const newCustomer = new Customer({
      storeId,
      name: '（未入力）',
      joinedAt: new Date()
    })
    await newCustomer.save()
    res.status(201).json({ message: '匿名受付完了' })
  } catch (err) {
    console.error('匿名受付エラー', err)
    res.status(500).json({ error: 'サーバーエラー' })
  }
})

// 顧客情報の更新（名前・コメント）
router.patch('/:storeId/update/:customerId', async (req, res) => {
  const { storeId, customerId } = req.params
  const { name, comment } = req.body

  if (storeId !== req.storeId) {
    return res.status(403).json({ message: '店舗が一致しません' })
  }

  try {
    const updated = await Customer.findOneAndUpdate(
      { _id: customerId, storeId },
      {
        $set: {
          ...(name !== undefined && { name }),
          ...(comment !== undefined && { comment })
        }
      },
      { new: true }
    )

    if (!updated) {
      return res.status(404).json({ message: '対象の顧客が見つかりませんでした' })
    }

    res.json({ message: '顧客情報を更新しました', customer: updated })
  } catch (err) {
    console.error('顧客情報更新エラー:', err)
    res.status(500).json({ message: '更新失敗' })
  }
})

module.exports = router
