const mongoose = require('mongoose')

const StoreSchema = new mongoose.Schema({
  name: String,
  location: String,
  pinCode: {
    type: String,
    required: true
  },
  // 他に必要なフィールドがあればここに
})

module.exports = mongoose.model('Store', StoreSchema)
