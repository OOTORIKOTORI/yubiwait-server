const mongoose = require('mongoose')

const CustomerSchema = new mongoose.Schema({
  name: String,
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
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

module.exports = mongoose.model('Customer', CustomerSchema)
