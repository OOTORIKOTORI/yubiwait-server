const mongoose = require('mongoose')
const bcrypt = require('bcrypt') // ←★これを忘れずに！

const StoreSchema = new mongoose.Schema({
  name: String,
  location: String,
  pinCode: String, // bcrypt hash

  // 待ち分/通知テンプレ（正式）
  waitMinutesPerPerson: { type: Number, default: 5 },
  notificationTemplate: {
    near:  { title: { type: String, default: '' }, body: { type: String, default: '' } },
    ready: { title: { type: String, default: '' }, body: { type: String, default: '' } },
  },

  // AutoCaller 設定
  autoCallerEnabled: { type: Boolean, default: true },
  maxServing: { type: Number, default: 1, min: 1, max: 10 },
})

StoreSchema.pre('save', async function (next) {
  if (!this.isModified('pinCode')) return next()

  try {
    const salt = await bcrypt.genSalt(10)
    this.pinCode = await bcrypt.hash(this.pinCode, salt)
    next()
  } catch (err) {
    next(err)
  }
})

module.exports = mongoose.model('Store', StoreSchema)
