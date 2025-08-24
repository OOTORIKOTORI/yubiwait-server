// routes/join.js
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const Customer = require('../models/Customer')
const Store = require('../models/Store')
const webpush = require('web-push')

function internalOnly(req, res, next) {
  const token = req.get('x-internal-token')
  if (process.env.INTERNAL_TOKEN && token === process.env.INTERNAL_TOKEN) return next()
  // 開発中だけ許可したいなら↓を有効化（本番は必ず締める）
  // if (!process.env.INTERNAL_TOKEN && process.env.NODE_ENV !== 'production') return next()
  return res.sendStatus(403)
}

// ===== 署名付きキャンセルトークン =====
const CANCEL_TOKEN_SECRET =
    process.env.CANCEL_TOKEN_SECRET || process.env.ADMIN_JWT_SECRET
const CANCEL_TOKEN_TTL_SEC = Number(process.env.CANCEL_TOKEN_TTL_SEC || 86400) // 既定24h

function b64url(buf) {
    return Buffer.from(buf)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

function signHmac(data, secret) {
    return b64url(crypto.createHmac('sha256', secret).update(data).digest())
}

function createCancelToken({ storeId, customerId, now = Date.now() }) {
    if (!CANCEL_TOKEN_SECRET) {
        throw new Error('CANCEL_TOKEN_SECRET is not set')
    }
    const iat = Math.floor(now / 1000)
    const exp = iat + CANCEL_TOKEN_TTL_SEC
    const payload = { sid: String(storeId), cid: String(customerId), iat, exp }
    const payloadB64 = b64url(JSON.stringify(payload))
    const sig = signHmac(payloadB64, CANCEL_TOKEN_SECRET)
    return `${payloadB64}.${sig}`
}

function verifyCancelToken(token, { storeId, customerId }) {
    if (!CANCEL_TOKEN_SECRET) return { ok: false, reason: 'no-secret' }
    if (typeof token !== 'string' || !token.includes('.'))
        return { ok: false, reason: 'format' }

    const [payloadB64, sig] = token.split('.')
    const expectedSig = signHmac(payloadB64, CANCEL_TOKEN_SECRET)
    const sigBuf = Buffer.from(sig)
    const expBuf = Buffer.from(expectedSig)
    if (sigBuf.length !== expBuf.length) return { ok: false, reason: 'bad-sign' }
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { ok: false, reason: 'bad-sign' }

    let payload
    try {
        payload = JSON.parse(fromB64url(payloadB64).toString('utf8'))
    } catch {
        return { ok: false, reason: 'bad-json' }
    }
    const now = Math.floor(Date.now() / 1000)
    if (!payload || !payload.exp || now > payload.exp) {
        return { ok: false, reason: 'expired' }
    }
    if (String(payload.sid) !== String(storeId) || String(payload.cid) !== String(customerId)) {
        return { ok: false, reason: 'mismatch' }
    }
    return { ok: true }
}

// ====== 受付登録 ======
router.post('/:storeId', async (req, res) => {
    const { storeId } = req.params
    const { name } = req.body

    try {
        // ざっくりバリデーション
        const displayName = (name ?? '').toString().trim().slice(0, 40) || '（未入力）'

        const newCustomer = new Customer({
            name: displayName,
            storeId,
            status: 'waiting',
            joinedAt: new Date()
        })
        await newCustomer.save()

        // キャンセル用トークン発行
        const cancelToken = createCancelToken({
            storeId,
            customerId: newCustomer._id,
            now: Date.now()
        })

        res.json({
            success: true,
            message: `${displayName}さんを${storeId}に登録しました！`,
            customerId: newCustomer._id,
            cancelToken
        })
    } catch (err) {
        console.error('登録エラー:', err)
        res.status(500).json({ success: false, message: '登録に失敗しました' })
    }
})

// ====== 待ち時間見積 ======
router.get('/:storeId/waiting-time', async (req, res) => {
    const { storeId } = req.params
    const { customerId } = req.query

    try {
        const store = await Store.findById(storeId).lean()
        const raw = store?.waitMinutesPerPerson
        const minutesPerPerson =
            Number.isFinite(raw) && raw > 0
                ? Math.min(Math.max(Math.floor(raw), 1), 120)
                : 5

        let waitingCount
        if (customerId) {
            const me = await Customer.findById(customerId)
            if (!me) return res.status(404).json({ message: '該当の客が見つかりませんでした' })
            waitingCount = await Customer.countDocuments({
                storeId,
                status: 'waiting',
                joinedAt: { $lt: me.joinedAt }
            })
        } else {
            waitingCount = await Customer.countDocuments({ storeId, status: 'waiting' })
        }

        res.json({
            waitingCount,
            estimatedMinutes: waitingCount * minutesPerPerson,
            minutesPerPerson
        })
    } catch (err) {
        console.error('待ち時間取得エラー:', err)
        res.status(500).json({ message: '待ち時間の取得に失敗しました' })
    }
})

// ====== VAPID 公開鍵 ======
router.get('/:storeId/publicKey', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
})

// ====== Push購読保存 ======
router.post('/:storeId/subscribe', async (req, res) => {
    const { customerId, subscription } = req.body
    if (!customerId || !subscription) {
        return res.status(400).json({ error: 'customerIdとsubscriptionは必須です' })
    }

    try {
        const customer = await Customer.findById(customerId)
        if (!customer) return res.status(404).json({ error: '該当する客がいません' })

        customer.subscription = subscription // 現状は単一端末のみ保持（最新で上書き）
        await customer.save()

        // デバッグ用のテスト通知は必要に応じてコメントアウト
        // await webpush.sendNotification(subscription, JSON.stringify({ title: '購読完了', body: '通知テスト！' }))

        res.status(201).json({ message: '購読情報を保存しました！' })
    } catch (err) {
        console.error('購読保存エラー:', err)
        res.status(500).json({ error: '購読情報の保存に失敗しました' })
    }
})

// ====== near/ready 通知（※内部利用を想定） ======
router.post('/:storeId/notify',internalOnly, async (req, res) => {
    const { storeId } = req.params
    const { customerId } = req.body

    try {
        let customer = await Customer.findById(customerId)
        // ObjectId と文字列を厳密比較しないよう toString() で比較
        if (!customer || String(customer.storeId) !== String(storeId)) {
            return res.status(404).json({ success: false, message: '顧客が見つからないか不一致' })
        }

        const waitingCount = await Customer.countDocuments({
            storeId,
            status: 'waiting',
            joinedAt: { $lt: customer.joinedAt }
        })

        const notifyTimings = [3, 1, 0]
        const alreadyNotified = (customer.notificationFlags || []).includes(waitingCount)

        if (notifyTimings.includes(waitingCount) && !alreadyNotified && customer.subscription) {
            const notificationData =
                waitingCount === 0
                    ? { title: 'あなたの番です！', body: '店舗にてお名前をお呼びしますのでご対応ください。' }
                    : {
                        title: waitingCount === 1 ? 'まもなく呼ばれます！' : 'あと少しで順番です！',
                        body: `あと${waitingCount}人であなたの番です。ご準備をお願いします。`
                    }

            try {
                if (waitingCount === 0) {
                    const now = new Date()
                    const updated = await Customer.findOneAndUpdate(
                        { _id: customerId, storeId, status: 'waiting' },
                        { $set: { status: 'serving', calledAt: now }, $addToSet: { notificationFlags: 0 } },
                        { new: true }
                    )
                    if (updated) {
                        customer = updated
                    } else {
                        await Customer.updateOne({ _id: customerId }, { $addToSet: { notificationFlags: 0 } })
                    }
                } else {
                    await Customer.updateOne(
                        { _id: customerId },
                        { $addToSet: { notificationFlags: waitingCount } }
                    )
                }

                try {
                    await webpush.sendNotification(customer.subscription, JSON.stringify(notificationData))
                } catch (e) {
                    if (e.statusCode === 404 || e.statusCode === 410) {
                        await Customer.updateOne({ _id: customerId }, { $unset: { subscription: "" } })
                    } else {
                        console.error('通知送信エラー:', e)
                    }
                }
            } catch (err) {
                console.error(`通知送信エラー (${waitingCount}人前):`, err)
            }
        }

        res.json({ success: true, waitingCount })
    } catch (err) {
        console.error('通知エラー:', err)
        res.status(500).json({ success: false, message: '通知処理に失敗しました' })
    }
})

// ====== キャンセル（本人性確認つき） ======
router.delete('/:storeId/cancel', async (req, res) => {
    const { storeId } = req.params
    const { customerId, cancelToken, subscription } = req.body || {}

    if (!customerId) return res.status(400).json({ error: 'customerId required' })

    try {
        const customer = await Customer.findById(customerId)
        if (!customer) return res.status(404).json({ error: 'not found' })

        // 店舗取り違え防止
        if (String(customer.storeId) !== String(storeId)) {
            return res.status(404).json({ error: 'store mismatch' })
        }

        // 状態チェック：基本は waiting のみ自己キャンセル可
        if (customer.status !== 'waiting') {
            return res.status(409).json({ error: 'cannot cancel in current status' })
        }

        // ルートA: 署名トークン（推奨）
        const byToken = cancelToken
            ? verifyCancelToken(cancelToken, { storeId, customerId }).ok
            : false

        // ルートB: Push購読 endpoint 一致（購読者向けの簡易ルート）
        const byEndpoint =
            subscription?.endpoint &&
            customer.subscription?.endpoint &&
            subscription.endpoint === customer.subscription.endpoint

        if (!byToken && !byEndpoint) {
            return res.status(403).json({ error: 'not authorized to cancel' })
        }

        await Customer.deleteOne({ _id: customerId })
        return res.json({ ok: true, message: 'キャンセル完了' })
    } catch (err) {
        console.error('キャンセル処理エラー:', err)
        return res.status(500).json({ error: 'cancel failed' })
    }
})

// 店舗名
router.get('/:storeId/name', async (req, res) => {
    const { storeId } = req.params
    try {
        const store = await Store.findById(storeId)
        if (!store) return res.status(404).json({ message: '店舗が見つかりません' })
        res.json({ name: store.name })
    } catch (err) {
        console.error('店舗名取得エラー:', err)
        res.status(500).json({ message: '店舗名の取得に失敗しました' })
    }
})

function fromB64url(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
    return Buffer.from(b64, 'base64')
}

module.exports = router
