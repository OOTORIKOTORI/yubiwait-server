const mongoose = require('mongoose')

const CustomerSchema = new mongoose.Schema({
  name: String,
  storeId: String,
  joinedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    default: 'waiting' // 他に: called, done など
  }
})

module.exports = mongoose.model('Customer', CustomerSchema)
