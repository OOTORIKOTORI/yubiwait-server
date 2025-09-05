// routes/join.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const webpush = require('web-push');
const Customer = require('../models/Customer');
const Store = require('../models/Store');
const mongoose = require('mongoose');
const {devOnly} = require('../middlewares/dev'); // パスは環境に合わせて

const { validate, z, id24 } = require('../middlewares/validate');

// ===== 内部API専用ミドルウェア（従来どおり） =====
function internalOnly(req, res, next) {
  const token = req.get('x-internal-token');
  if (process.env.INTERNAL_TOKEN && token === process.env.INTERNAL_TOKEN) return next();
  // if (!process.env.INTERNAL_TOKEN && process.env.NODE_ENV !== 'production') return next(); // dev専用ゆるめ
  return res.sendStatus(403);
}

// ===== 署名付きキャンセルトークン =====
const CANCEL_TOKEN_SECRET =
  process.env.CANCEL_TOKEN_SECRET || process.env.ADMIN_JWT_SECRET;
const CANCEL_TOKEN_TTL_SEC = Number(process.env.CANCEL_TOKEN_TTL_SEC || 86400); // 既定24h

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Buffer.from(b64, 'base64');
}
function signHmac(data, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest());
}
function createCancelToken({ storeId, customerId, now = Date.now() }) {
  if (!CANCEL_TOKEN_SECRET) {
    throw new Error('CANCEL_TOKEN_SECRET is not set');
  }
  const iat = Math.floor(now / 1000);
  const exp = iat + CANCEL_TOKEN_TTL_SEC;
  const payload = { sid: String(storeId), cid: String(customerId), iat, exp };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = signHmac(payloadB64, CANCEL_TOKEN_SECRET);
  return `${payloadB64}.${sig}`;
}
function verifyCancelToken(token, { storeId, customerId }) {
  if (!CANCEL_TOKEN_SECRET) return { ok: false, reason: 'no-secret' };
  if (typeof token !== 'string' || !token.includes('.'))
    return { ok: false, reason: 'format' };

  const [payloadB64, sig] = token.split('.');
  const expectedSig = signHmac(payloadB64, CANCEL_TOKEN_SECRET);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return { ok: false, reason: 'bad-sign' };
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { ok: false, reason: 'bad-sign' };

  let payload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || !payload.exp || now > payload.exp) return { ok: false, reason: 'expired' };
  if (String(payload.sid) !== String(storeId) || String(payload.cid) !== String(customerId)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}

// ==================== Zod スキーマ ====================
// 受付登録
const postJoinSchema = z.object({
  params: z.object({ storeId: id24 }),
  body: z.object({
    name: z.string().trim().min(1).max(40)
  }).strict()
});
// 待ち時間
const waitingTimeSchema = z.object({
  params: z.object({ storeId: id24 }),
  query: z.object({
    customerId: id24.optional()
  }).partial()
});
// 公開鍵
const publicKeySchema = z.object({
  params: z.object({ storeId: id24 })
});
// 購読保存
const subscribeSchema = z.object({
  params: z.object({ storeId: id24 }),
  body: z.object({
    customerId: id24,
    subscription: z.object({
      endpoint: z.string().url()
    }).passthrough()
  }).strict()
});
// 内部 near/ready 通知
const internalNotifySchema = z.object({
  params: z.object({ storeId: id24 }),
  body: z.object({
    customerId: id24
  }).strict()
});
// キャンセル
const cancelSchema = z.object({
  params: z.object({ storeId: id24 }),
  body: z.object({
    customerId: id24,
    cancelToken: z.string().min(1).optional(),
    subscription: z.object({ endpoint: z.string().url() }).partial().optional()
  })
    .strict()
    .refine(
      (b) => !!b.cancelToken || !!b.subscription?.endpoint,
      { message: 'cancelToken または subscription.endpoint のどちらかが必要です' }
    )
});
// 店舗名
const nameSchema = z.object({
  params: z.object({ storeId: id24 })
});

// ==================== ルート ====================

// ====== 受付登録 ======
router.post('/:storeId', validate(postJoinSchema), async (req, res) => {
  const { storeId } = req.params;
  const sid = new mongoose.Types.ObjectId(storeId);
  const { name } = req.body;

  try {
    const displayName = name; // zodでtrim/長さチェック済み
    const newCustomer = new Customer({
      name: displayName,
      storeId: sid,
      status: 'waiting',
      joinedAt: new Date()
    });
    await newCustomer.save();

    const cancelToken = createCancelToken({ storeId: sid, customerId: newCustomer._id, now: Date.now() });

    res.json({
      success: true,
      message: `${displayName}さんを${storeId}に登録しました！`,
      customerId: newCustomer._id,
      cancelToken
    });
  } catch (err) {
    console.error('登録エラー:', err);
    res.status(500).json({ success: false, message: '登録に失敗しました' });
  }
});

// ====== 待ち時間見積 ======
router.get('/:storeId/waiting-time', validate(waitingTimeSchema), async (req, res) => {
  const { storeId } = req.params;
  const sid = new mongoose.Types.ObjectId(storeId);
  const { customerId } = req.query;

  try {
    const store = await Store.findById(storeId).lean();
    const raw = store?.waitMinutesPerPerson;
    const minutesPerPerson =
      Number.isFinite(raw) && raw > 0
        ? Math.min(Math.max(Math.floor(raw), 1), 120) // 既存ロジック踏襲（上限120）
        : 5;

    let waitingCount;
    if (customerId) {
      const me = await Customer.findById(customerId);
      if (!me) return res.status(404).json({ message: '該当の客が見つかりませんでした' });
      waitingCount = await Customer.countDocuments({ storeId: me.storeId, status: 'waiting', joinedAt: { $lt: me.joinedAt } });
    } else {
      waitingCount = await Customer.countDocuments({ storeId: sid, status: 'waiting' });
    }

    res.json({
      waitingCount,
      estimatedMinutes: waitingCount * minutesPerPerson,
      minutesPerPerson
    });
  } catch (err) {
    console.error('待ち時間取得エラー:', err);
    res.status(500).json({ message: '待ち時間の取得に失敗しました' });
  }
});

// ====== VAPID 公開鍵 ======
router.get('/:storeId/publicKey', validate(publicKeySchema), (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ====== Push購読保存 ======
router.post('/:storeId/subscribe', validate(subscribeSchema), async (req, res) => {
  const { customerId, subscription } = req.body;

  try {
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ error: '該当する客がいません' });

    customer.subscription = subscription; // 単一端末のみ保持（最新で上書き）
    await customer.save();

    // await webpush.sendNotification(subscription, JSON.stringify({ title: '購読完了', body: '通知テスト！' }));
    res.status(201).json({ message: '購読情報を保存しました！' });
  } catch (err) {
    console.error('購読保存エラー:', err);
    res.status(500).json({ error: '購読情報の保存に失敗しました' });
  }
});

// ====== near/ready 通知（※内部利用） ======
router.post('/:storeId/notify', internalOnly, validate(internalNotifySchema), async (req, res) => {
  const { storeId } = req.params;
  const sid = new mongoose.Types.ObjectId(storeId);
  const { customerId } = req.body;

  try {
    let customer = await Customer.findById(customerId);
    if (!customer || String(customer.storeId) !== String(storeId)) {
      return res.status(404).json({ success: false, message: '顧客が見つからないか不一致' });
    }

    const waitingCount = await Customer.countDocuments({ storeId: customer.storeId, status: 'waiting', joinedAt: { $lt: customer.joinedAt } });

    const notifyTimings = [3, 1, 0];
    const alreadyNotified = (customer.notificationFlags || []).includes(waitingCount);

    if (notifyTimings.includes(waitingCount) && !alreadyNotified) {

      const notificationData =
        waitingCount === 0
          ? { title: 'あなたの番です！', body: '店舗にてお名前をお呼びしますのでご対応ください。' }
          : {
            title: waitingCount === 1 ? 'まもなく呼ばれます！' : 'あと少しで順番です！',
            body: `あと${waitingCount}人であなたの番です。ご準備をお願いします。`
          };

      try {
        if (waitingCount === 0) {
          const now = new Date();
          const updated = await Customer.findOneAndUpdate({ _id: customerId, storeId: customer.storeId, status: 'waiting' }, { $set: { status: 'serving', calledAt: now }, $addToSet: { notificationFlags: 0 } }, { new: true });
          if (updated) {
            customer = updated;
          } else {
            await Customer.updateOne({ _id: customerId }, { $addToSet: { notificationFlags: 0 } });
          }
        } else {
          await Customer.updateOne(
            { _id: customerId },
            { $addToSet: { notificationFlags: waitingCount } }
          );
        }

        try {
          if (customer.subscription) {
            await webpush.sendNotification(customer.subscription, JSON.stringify(notificationData));
          }
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            await Customer.updateOne({ _id: customerId }, { $unset: { subscription: '' } });
          } else {
            console.error('通知送信エラー:', e);
          }
        }
      } catch (err) {
        console.error(`通知送信エラー (${waitingCount}人前):`, err);
      }
    }

    res.json({ success: true, waitingCount });
  } catch (err) {
    console.error('通知エラー:', err);
    res.status(500).json({ success: false, message: '通知処理に失敗しました' });
  }
});

// ====== キャンセル（本人性確認つき） ======
router.delete('/:storeId/cancel', validate(cancelSchema), async (req, res) => {
  const { storeId } = req.params;
  const { customerId, cancelToken, subscription } = req.body || {};

  try {
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ error: 'not found' });

    if (String(customer.storeId) !== String(storeId)) {
      return res.status(404).json({ error: 'store mismatch' });
    }

    if (customer.status !== 'waiting') {
      return res.status(409).json({ error: 'cannot cancel in current status' });
    }

    const byToken = cancelToken
      ? verifyCancelToken(cancelToken, { storeId, customerId }).ok
      : false;

    const byEndpoint =
      subscription?.endpoint &&
      customer.subscription?.endpoint &&
      subscription.endpoint === customer.subscription.endpoint;

    if (!byToken && !byEndpoint) {
      return res.status(403).json({ error: 'not authorized to cancel' });
    }

    await Customer.deleteOne({ _id: customerId });
    return res.json({ ok: true, message: 'キャンセル完了' });
  } catch (err) {
    console.error('キャンセル処理エラー:', err);
    return res.status(500).json({ error: 'cancel failed' });
  }
});

// ====== 店舗名 ======
router.get('/:storeId/name', validate(nameSchema), async (req, res) => {
  const { storeId } = req.params;
  try {
    const store = await Store.findById(storeId);
    if (!store) return res.status(404).json({ message: '店舗が見つかりません' });
    res.json({ name: store.name });
  } catch (err) {
    console.error('店舗名取得エラー:', err);
    res.status(500).json({ message: '店舗名の取得に失敗しました' });
  }
});

// 開発専用: 行列クリア（waiting/servingのみ削除）
router.post('/:storeId/dev-reset', devOnly, internalOnly, async (req, res) => {
  const { storeId } = req.params;
  const sidObj = new mongoose.Types.ObjectId(storeId);
  const idQuery = { $in: [sidObj, storeId] };
  const result = await Customer.deleteMany({
    storeId: idQuery,
    status: { $in: ['waiting', 'serving'] }
  });
  res.json({ ok: true, deletedCount: result.deletedCount });
});

// 開発専用: フラグと並びを確認（内部トークン必須）
router.get('/:storeId/dev-flags', devOnly, internalOnly, async (req, res) => {
  const { storeId } = req.params;
  const sidObj = new mongoose.Types.ObjectId(storeId);
  const idQuery = { $in: [sidObj, storeId] };

  const waiting = await Customer.find({ storeId: idQuery, status: 'waiting' })
    .sort({ joinedAt: 1 })
    .select({ _id: 1, notificationFlags: 1, joinedAt: 1 })
    .lean();

  const serving = await Customer.find({ storeId: idQuery, status: 'serving' })
    .sort({ calledAt: 1 })
    .select({ _id: 1, notificationFlags: 1, calledAt: 1 })
    .lean();

  res.json({
    waiting: waiting.map((c, i) => ({
      customerId: String(c._id),
      pos: i, // 0が先頭（head）
      notificationFlags: c.notificationFlags || []
    })),
    serving: serving.map((c, i) => ({
      customerId: String(c._id),
      pos: i,
      notificationFlags: c.notificationFlags || []
    }))
  });
});

module.exports = router;
