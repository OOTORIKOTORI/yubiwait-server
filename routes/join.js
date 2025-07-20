const express = require('express')
const router = express.Router()
const Customer = require('../models/Customer')

router.post('/:storeId', async (req, res) => {
  const { storeId } = req.params
  const { name } = req.body

  try {
    const newCustomer = new Customer({ name, storeId })
    await newCustomer.save()
    res.json({ success: true, message: `${name}さんを${storeId}に登録しました！` })
  } catch (err) {
    console.error('登録エラー:', err)
    res.status(500).json({ success: false, message: '登録に失敗しました' })
  }
})

module.exports = router
