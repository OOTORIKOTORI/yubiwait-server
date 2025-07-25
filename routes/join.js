const express = require('express')
const router = express.Router()
const Customer = require('../models/Customer')
const webpush = require('web-push')


router.post('/:storeId', async (req, res) => {
    const { storeId } = req.params
    const { name } = req.body

    try {
        const newCustomer = new Customer({ name, storeId })
        await newCustomer.save()
        res.json({
            success: true,
            message: `${name}さんを${storeId}に登録しました！`,
            customerId: newCustomer._id
        })
    } catch (err) {
        console.error('登録エラー:', err)
        res.status(500).json({ success: false, message: '登録に失敗しました' })
    }
})

router.get('/:storeId/waiting-time', async (req, res) => {
    const { storeId } = req.params
    const { customerId } = req.query

    try {
        let waitingCount

        if (customerId) {
            const me = await Customer.findById(customerId)
            if (!me) {
                return res.status(404).json({ message: '該当の客が見つかりませんでした' })
            }

            // 自分より先に joinedAt された waiting 状態の人の数を数える
            waitingCount = await Customer.countDocuments({
                storeId,
                status: 'waiting',
                joinedAt: { $lt: me.joinedAt }
            })
        } else {
            // customerId がない場合は、waiting 全体の数を返す
            waitingCount = await Customer.countDocuments({ storeId, status: 'waiting' })
        }

        const estimatedMinutes = waitingCount * 5  // 1人あたり5分で仮定
        res.json({ waitingCount, estimatedMinutes })
    } catch (err) {
        console.error('待ち時間取得エラー:', err)
        res.status(500).json({ message: '待ち時間の取得に失敗しました' })
    }
})

router.get('/:storeId/publicKey', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post('/:storeId/subscribe', async (req, res) => {
    const { customerId, subscription } = req.body

    if (!customerId || !subscription) {
        return res.status(400).json({ error: 'customerIdとsubscriptionは必須です' })
    }

    try {
        const customer = await Customer.findById(customerId)
        if (!customer) {
            return res.status(404).json({ error: '該当する客がいません' })
        }

        customer.subscription = subscription
        await customer.save()

        // 🧪 テスト通知は削除 or コメントアウトしてOK
        await webpush.sendNotification(
            subscription,
            JSON.stringify({ title: '購読完了', body: '通知テスト！' })
        )

        res.status(201).json({ message: '購読情報を保存しました！' })
    } catch (err) {
        console.error('購読保存エラー:', err)
        res.status(500).json({ error: '購読情報の保存に失敗しました' })
    }
})

router.post('/:storeId/notify', async (req, res) => {
    const { storeId } = req.params
    const { customerId } = req.body

    try {
        const customer = await Customer.findById(customerId)
        if (!customer || customer.storeId !== storeId) {
            return res.status(404).json({ success: false, message: '顧客が見つからないか不一致' })
        }

        // 前に何人いるか計算
        const waitingCount = await Customer.countDocuments({
            storeId,
            status: 'waiting',
            joinedAt: { $lt: customer.joinedAt }
        })

        // 通知タイミング候補（順番が来た0も含む）
        const notifyTimings = [3, 1, 0]

        // まだ送ってない通知タイミングか？
        if (
            notifyTimings.includes(waitingCount) &&
            !customer.notificationFlags.includes(waitingCount)
        ) {
            // 通知送信
            if (customer.subscription) {
                // 文言切り替え
                const notificationData =
                    waitingCount === 0
                        ? {
                            title: 'あなたの番です！',
                            body: '店舗にてお名前をお呼びしますのでご対応ください。',
                        }
                        : {
                            title: waitingCount === 1 ? 'まもなく呼ばれます！' : 'あと少しで順番です！',
                            body: `あと${waitingCount}人であなたの番です。ご準備をお願いします。`,
                        }

                try {
                    await webpush.sendNotification(
                        customer.subscription,
                        JSON.stringify(notificationData)
                    )

                    // 通知済みフラグを追加して保存
                    customer.notificationFlags.push(waitingCount)
                    await customer.save()
                } catch (err) {
                    console.error(`通知送信エラー (${waitingCount}人前):`, err)
                }
            }
        }

        res.json({ success: true, waitingCount })
    } catch (err) {
        console.error('通知エラー:', err)
        res.status(500).json({ success: false, message: '通知処理に失敗しました' })
    }
})

// routes/join.js
router.delete('/:storeId/cancel', async (req, res) => {
  const { customerId } = req.body
  if (!customerId) return res.status(400).json({ error: 'customerId required' })

  await Customer.deleteOne({ _id: customerId })
  res.json({ message: 'キャンセル完了' })
})


module.exports = router
