const mongoose = require('mongoose')

const CustomerSchema = new mongoose.Schema({
  name: String,
  storeId: String,
  joinedAt: {
    type: Date,
    default: Date.now
  },
  calledAt: { type: Date },
  status: {
    type: String,
    default: 'waiting' // 他に: called, done など
  },
  subscription: { type: Object },
  notificationFlags: {
    type: [Number],
    default: []
  },
  comment: { type: String, default: '' } // ←★ここ追加
})

CustomerSchema.index({ storeId: 1, status: 1, joinedAt: 1 })
CustomerSchema.index({ storeId: 1, status: 1, calledAt: 1 })

module.exports = mongoose.model('Customer', CustomerSchema)
