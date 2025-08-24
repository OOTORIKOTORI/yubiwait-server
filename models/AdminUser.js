// models/AdminUser.js
const mongoose = require('mongoose');

const AdminUserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true, index: true },
  password_hash: { type: String, required: true },
  store_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true }],
  role: { type: String, enum: ['owner', 'manager'], default: 'owner' },
}, { timestamps: true });

AdminUserSchema.index({ email: 1 }, { unique: true })

module.exports = mongoose.model('AdminUser', AdminUserSchema);
