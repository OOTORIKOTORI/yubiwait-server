const express = require('express')
const router = express.Router()
const Customer = require('../models/Customer')

router.get('/:storeId', async (req, res) => {
  const { storeId } = req.params

  try {
    const customers = await Customer.find({ storeId, status: 'waiting' }).sort('joinedAt')
    res.json({ storeId, customers })
  } catch (err) {
    console.error('一覧取得エラー:', err)
    res.status(500).json({ message: '一覧取得失敗' })
  }
})

module.exports = router
