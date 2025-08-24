// server/autoCaller.js
const Customer = require('./models/Customer')
const Store = require('./models/Store') // 既存のStoreモデル名に合わせて
const webpush = require('web-push')

async function sendPush(customer, store, type) {
    if (!customer?.subscription) return
    const nt = (store?.notificationTemplate || {})
    const title = type === 'ready'
        ? (nt.ready?.title || 'ご案内の順番になりました')
        : (nt.near?.title || 'まもなくご案内です')
    const body = type === 'ready'
        ? (nt.ready?.body || 'スタッフにお名前をお伝えください。')
        : (nt.near?.body || 'まもなくお呼びします。少々お待ちください。')

    const payload = JSON.stringify({
        type,
        title,
        body,
        url: `/join/${store?._id || customer.storeId}`
    })
    try {
        await webpush.sendNotification(customer.subscription, payload)
    } catch (e) {
        // 無効購読は掃除
        if (e.statusCode === 404 || e.statusCode === 410) {
            await Customer.updateOne({ _id: customer._id }, { $unset: { subscription: "" } })
        } else {
            console.error('push error:', e)
        }
    }
}

/**
 * 1店舗を処理：
 * - serving がいなければ、waiting 先頭を serving に昇格（calledAt=now, ready Push）
 * - waiting 中の上位に near 通知（残3/1人）を一度だけ送る（重複防止は notificationFlags）
 */
async function processStore(store) {
    const storeId = String(store._id)
    // waiting を上位4件だけ取得（0/1/2/3人前までのnear判定に十分）
    const waiting = await Customer.find({ storeId, status: 'waiting' })
        .sort({ joinedAt: 1 })
        .limit(4)
        .lean()

    // near 通知（重複防止: notificationFlags に 3,1 を記録）
    for (let i = 0; i < waiting.length; i++) {
        const ahead = i // 自分より前の waiting の人数
        if (ahead === 3 || ahead === 1) {
            const c = waiting[i]
            const flags = new Set(c.notificationFlags || [])
            if (!flags.has(ahead)) {
                await sendPush(c, store, 'near')
                await Customer.updateOne({ _id: c._id }, { $addToSet: { notificationFlags: ahead } })
            }
        }
    }

    // すでに呼び出し中がいれば何もしない
    const maxServing = Number(process.env.MAX_SERVING || 1)
    const servingCount = await Customer.countDocuments({ storeId, status: 'serving' })
    if (servingCount >= maxServing) return

    // 先頭がいれば ready（waiting→serving + calledAt + ready Push + flag 0）
    const head = waiting[0]
    if (!head) return
    const res = await Customer.updateOne(
        { _id: head._id, status: 'waiting' }, // 競合時の二重昇格防止
        { $set: { status: 'serving', calledAt: new Date() }, $addToSet: { notificationFlags: 0 } }
    )
    if (res.modifiedCount === 1) {
        await sendPush(await Customer.findById(head._id).lean(), store, 'ready')
    }
}

let running = false
async function tick() {
    console.log('[AutoCaller] tick')
    if (running) return
    running = true
    try {
        const stores = await Store.find({}, { _id: 1, notificationTemplate: 1 }).lean()
        for (const s of stores) {
            await processStore(s)
        }
    } catch (e) {
        console.error('autoCaller tick error:', e)
    } finally {
        running = false
    }
}

function startAutoCaller(options = {}) {
    const intervalMs = Number(process.env.AUTO_CALLER_INTERVAL_MS || options.intervalMs || 10_000)
    console.log('[AutoCaller] start:', intervalMs)
    setInterval(tick, intervalMs)
    tick() // 起動直後に1回
}

module.exports = { startAutoCaller }
