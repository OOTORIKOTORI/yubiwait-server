// routes/adminPin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const requireAdmin = require('../middlewares/requireAdmin');
const Store = require('../models/Store');
const { validate, z, id24 } = require('../middlewares/validate');

const router = express.Router();

// params: :storeId, body: { newPin }
const resetPinSchema = z.object({
  params: z.object({ storeId: id24 }),
  body: z.object({
    newPin: z.string().trim().regex(/^\d{4,8}$/, '4〜8桁の数字のみ')
  }).strict()
});

router.post('/stores/:storeId/reset-pin', requireAdmin, validate(resetPinSchema), async (req, res) => {
  const { storeId } = req.params;

  if (!req.admin?.storeIds?.map(String).includes(String(storeId))) {
    return res.status(403).json({ error: 'Forbidden: store not allowed' });
  }

  const { newPin } = req.body;

  const hash = await bcrypt.hash(String(newPin), 10);
  const updated = await Store.findByIdAndUpdate(
    storeId,
    { $set: { pinCode: hash } },
    { new: true, lean: true }
  );
  if (!updated) return res.status(404).json({ error: 'Store not found' });

  return res.json({ ok: true });
});

module.exports = router;
