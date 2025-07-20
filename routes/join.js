const express = require('express')
const router = express.Router()
const Customer = require('../models/Customer')

router.post('/:storeId', async (req, res) => {
    const { storeId } = req.params
    const { name } = req.body

    try {
        const newCustomer = new Customer({ name, storeId })
        await newCustomer.save()
        res.json({
            success: true,
            message: `${name}さんを${storeId}に登録しました！`,
            customerId: newCustomer._id
        })
    } catch (err) {
        console.error('登録エラー:', err)
        res.status(500).json({ success: false, message: '登録に失敗しました' })
    }
})

router.get('/:storeId/waiting-time', async (req, res) => {
  const { storeId } = req.params
  const { customerId } = req.query

  try {
    let waitingCount

    if (customerId) {
      const me = await Customer.findById(customerId)
      if (!me) {
        return res.status(404).json({ message: '該当の客が見つかりませんでした' })
      }

      // 自分より先に joinedAt された waiting 状態の人の数を数える
      waitingCount = await Customer.countDocuments({
        storeId,
        status: 'waiting',
        joinedAt: { $lt: me.joinedAt }
      })
    } else {
      // customerId がない場合は、waiting 全体の数を返す
      waitingCount = await Customer.countDocuments({ storeId, status: 'waiting' })
    }

    const estimatedMinutes = waitingCount * 5  // 1人あたり5分で仮定
    res.json({ waitingCount, estimatedMinutes })
  } catch (err) {
    console.error('待ち時間取得エラー:', err)
    res.status(500).json({ message: '待ち時間の取得に失敗しました' })
  }
})

module.exports = router
