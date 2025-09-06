// scripts/seed_ci.js — CI用の最小データ投入（stores 1件）

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('ERROR: MONGODB_URI is required'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const parsed = new URL(uri);
    const dbName = (parsed.pathname && parsed.pathname.replace(/^\//, '')) || 'test';
    const db = client.db(dbName);

    const stores = db.collection('stores');
    const idHex = process.env.STORE_ID || '687e4062912938dd2558db4f';
    const _id = new ObjectId(idHex);

    const doc = {
      _id,
      name: 'CI Store',
      location: 'CI',
      waitMinutesPerPerson: 7,
      notificationTemplate: { near: { title: '', body: '' }, ready: { title: '', body: '' } },
      autoCaller: { enabled: true, maxServing: 2 }
    };

    await stores.updateOne(
      { _id },
      {
        $set: {
          _id, name: 'CI Store', location: 'CI',
          waitMinutesPerPerson: 7,
          notificationTemplate: { near: { title: '', body: '' }, ready: { title: '', body: '' } },
          // 新仕様（ネスト）
          autoCaller: { enabled: true, maxServing: 2 },
          // 旧仕様（トップ）
          autoCallerEnabled: true,
          maxServing: 2,
        }
      },
      { upsert: true }
    );

    await db.collection('customers').deleteMany({ storeId: idHex });
    console.log('Seeded store and cleared customers for', idHex);
  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
