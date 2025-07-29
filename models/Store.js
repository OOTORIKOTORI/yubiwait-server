const mongoose = require('mongoose')
const bcrypt = require('bcrypt') // ←★これを忘れずに！

const StoreSchema = new mongoose.Schema({
  name: String,
  location: String,
  pinCode: {
    type: String,
    required: true
  },
  // 他に必要なフィールドがあればここに
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
