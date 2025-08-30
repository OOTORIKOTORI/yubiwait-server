// routes/staff.js
const express = require('express');
const router = express.Router();

const Customer = require('../models/Customer');
const QueueHistory = require('../models/QueueHistory');
const Store = require('../models/Store');
const webpush = require('web-push');

const authenticateStore = require('../middlewares/auth');
const { validate, z, id24 } = require('../middlewares/validate');

// ---- 共有Zod ----
const ParamsStoreZ = z.object({ storeId: id24 });
const ParamsStoreCustomerZ = z.object({ storeId: id24, customerId: id24 });

const QueryStatusZ = z.object({
  status: z.enum(['all', 'serving', 'waiting']).optional()
}).strict();

const BodyUpdateZ = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  comment: z.string().trim().max(500).optional()
})
  .strict()
  .refine(b => b.name !== undefined || b.comment !== undefined, {
    message: 'name または comment のいずれかが必要です'
  });

// ---- 一覧（waiting / serving / all） ----
router.get(
  '/:storeId',
  validate(z.object({ params: ParamsStoreZ, query: QueryStatusZ })), // ← 先に検証（正規化もここで実施）
  authenticateStore,                                                 // ← その後で認証
  async (req, res) => {
    const { storeId } = req.params;
    const mode = (req.query.status || 'waiting').toLowerCase();

    if (storeId !== req.storeId) return res.status(403).json({ message: '店舗が一致しません' });

    try {
      if (mode === 'all') {
        const [waiting, serving] = await Promise.all([
          Customer.find({ storeId, status: 'waiting' }).sort('joinedAt').lean(),
          Customer.find({ storeId, status: 'serving' }).sort('calledAt').lean()
        ]);
        return res.json({ storeId, waiting, serving });
      }
      if (mode === 'serving') {
        const serving = await Customer.find({ storeId, status: 'serving' }).sort('calledAt').lean();
        return res.json({ storeId, customers: serving });
      }
      const customers = await Customer.find({ storeId, status: 'waiting' }).sort('joinedAt').lean();
      return res.json({ storeId, customers });
    } catch (err) {
      console.error('一覧取得エラー:', err);
      res.status(500).json({ message: '一覧取得失敗' });
    }
  }
);

// ---- 完了（履歴保存） ----
router.patch(
  '/:storeId/done/:customerId',
  validate(z.object({ params: ParamsStoreCustomerZ })),
  authenticateStore,
  async (req, res) => {
    const { storeId, customerId } = req.params;
    if (storeId !== req.storeId) return res.status(403).json({ message: '店舗が一致しません' });

    try {
      const customer = await Customer.findOne({ _id: customerId, storeId });
      if (!customer) return res.status(404).json({ message: '対象の顧客が見つかりませんでした' });
      if (customer.status === 'done') return res.json({ message: '既に完了済みです', customer });

      const now = new Date();
      const joined = customer.joinedAt || customer.createdAt || now;
      const called = customer.calledAt || now;
      const completed = customer.completedAt || now;

      customer.status = 'done';
      customer.completedAt = completed;
      await customer.save();

      const waitMin = Math.max(0, Math.round((called - joined) / 60000));
      const serviceMin = Math.max(0, Math.round((completed - called) / 60000));

      QueueHistory.create({
        store_id: storeId,
        customer_name: customer.name || '',
        joined_at: joined,
        completed_at: completed,
        wait_minutes: waitMin,
        service_minutes: serviceMin
      }).catch(e => console.error('[history] save failed:', e));

      res.json({ message: '完了にしました', customer });
    } catch (err) {
      console.error('完了処理エラー:', err);
      res.status(500).json({ message: '完了処理失敗' });
    }
  }
);

// ---- 匿名受付 ----
router.post(
  '/:storeId/anonymous',
  validate(z.object({ params: ParamsStoreZ })),
  authenticateStore,
  async (req, res) => {
    const { storeId } = req.params;
    if (storeId !== req.storeId) return res.status(403).json({ message: '店舗が一致しません' });

    try {
      const doc = new Customer({ storeId, name: '（未入力）', joinedAt: new Date() });
      await doc.save();
      res.status(201).json({ message: '匿名受付完了' });
    } catch (err) {
      console.error('匿名受付エラー', err);
      res.status(500).json({ error: 'サーバーエラー' });
    }
  }
);

// ---- 顧客編集（名前・コメント） ----
router.patch(
  '/:storeId/update/:customerId',
  validate(z.object({ params: ParamsStoreCustomerZ, body: BodyUpdateZ })),
  authenticateStore,
  async (req, res) => {
    const { storeId, customerId } = req.params;
    const { name, comment } = req.body;
    if (storeId !== req.storeId) return res.status(403).json({ message: '店舗が一致しません' });

    try {
      const $set = {};
      if (name !== undefined) $set.name = name;
      if (comment !== undefined) $set.comment = comment;

      const updated = await Customer.findOneAndUpdate(
        { _id: customerId, storeId },
        { $set },
        { new: true }
      );

      if (!updated) return res.status(404).json({ message: '対象の顧客が見つかりませんでした' });
      res.json({ message: '顧客情報を更新しました', customer: updated });
    } catch (err) {
      console.error('顧客情報更新エラー:', err);
      res.status(500).json({ message: '更新失敗' });
    }
  }
);

// ---- 再通知（serving に Push） ----
async function recallHandler(req, res) {
  const { storeId, customerId } = req.params;
  if (storeId !== req.storeId) return res.status(403).json({ message: '店舗が一致しません' });

  try {
    const customer = await Customer.findOne({ _id: customerId, storeId });
    if (!customer) return res.status(404).json({ message: '対象の顧客が見つかりませんでした' });
    if (customer.status !== 'serving') {
      return res.status(409).json({ message: '呼び出し中でないため再通知できません' });
    }

    const now = Date.now();
    const last = customer.lastManualCallAt ? customer.lastManualCallAt.getTime() : 0;
    if (now - last < 60_000) return res.status(429).json({ message: '短時間に連続再通知はできません' });

    if (!customer.subscription) {
      customer.lastManualCallAt = new Date();
      customer.manualCallCount = (customer.manualCallCount || 0) + 1;
      await customer.save();
      return res.status(202).json({ message: '購読がないため通知は送信されませんでした' });
    }

    // 通知テンプレ（ready を流用）
    let title = 'ご案内の順番になりました（再通知）';
    let body = 'スタッフにお名前をお伝えください。';
    try {
      const store = await Store.findById(storeId).lean();
      const t = store?.notificationTemplate?.ready;
      if (t?.title) title = `${t.title}（再通知）`;
      if (t?.body) body = t.body;
    } catch (_) { }

    const payload = JSON.stringify({ type: 'ready', title, body, url: `/join/${storeId}` });

    try {
      await webpush.sendNotification(customer.subscription, payload);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await Customer.updateOne({ _id: customer._id }, { $unset: { subscription: '' } });
      } else {
        console.error('再通知 push error:', e);
      }
    }

    customer.lastManualCallAt = new Date();
    customer.manualCallCount = (customer.manualCallCount || 0) + 1;
    await customer.save();

    res.json({ message: '再通知を送信しました' });
  } catch (e) {
    console.error('再通知エラー:', e);
    res.status(500).json({ message: '再通知に失敗しました' });
  }
}

router.post(
  '/:storeId/recall/:customerId',
  validate(z.object({ params: ParamsStoreCustomerZ })),
  authenticateStore,
  recallHandler
);
router.patch(
  '/:storeId/recall/:customerId',
  validate(z.object({ params: ParamsStoreCustomerZ })),
  authenticateStore,
  recallHandler
);

module.exports = router;
