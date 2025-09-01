// scripts/create_indexes.js — 全コレクションのインデックスを“外部スクリプト一本化”で保証（冪等）
// Usage:
//   MONGODB_URI="mongodb://localhost:27017/yourdb" node scripts/create_indexes.js
// Options:
//   RENAME_INDEXES=1   -> 同じキーで別名の既存indexを drop→新名でcreate
//   ALTER_INDEXES=1    -> unique 等のオプションが異なる既存indexを drop→再作成（※重複データがあると失敗）

require('dotenv').config();
const { MongoClient } = require('mongodb');

const TARGETS = [
  // customers
  { coll: 'customers', name: 'customers_store_status_joinedAt', keys: { storeId:1, status:1, joinedAt:1 } },
  { coll: 'customers', name: 'customers_store_status_calledAt',  keys: { storeId:1, status:1, calledAt:1 } },

  // adminusers (email unique)
  { coll: 'adminusers', name: 'adminusers_email_unique', keys: { email:1 }, options: { unique: true } },

  // queuehistories
  { coll: 'queuehistories', name: 'queuehistories_store_completedAt', keys: { store_id:1, completed_at:-1 } },
];

const sameKeys = (a, b) => {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length != bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    const k = ak[i];
    if (k !== bk[i]) return false;    // 順序一致も見る
    if (a[k] !== b[k]) return false;
  }
  return true;
};

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('ERROR: MONGODB_URI is required'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const parsed = new URL(uri);
    const dbName = (parsed.pathname && parsed.pathname.replace(/^\//,'')) || 'test';
    const db = client.db(dbName);

    const rename = process.env.RENAME_INDEXES === '1';
    const alter  = process.env.ALTER_INDEXES === '1';

    for (const t of TARGETS) {
      const col = db.collection(t.coll);
      const existing = await col.indexes(); // [{name, key, unique, ...}]

      const found = existing.find(ix => sameKeys(ix.key, t.keys));
      if (found) {
        const nameSame = found.name === t.name;
        const uniqueSame = (found.unique || false) === ((t.options && t.options.unique) || false);

        if (nameSame && uniqueSame) {
          console.log(`✔ exists: ${t.coll}.${t.name}`);
          continue;
        }

        // オプション（unique等）が違う
        if (!uniqueSame) {
          if (!alter) {
            console.log(`⚠︎ exists with different options on ${t.coll}: name=${found.name}, unique=${!!found.unique} (target unique=${!!(t.options && t.options.unique)})`);
            console.log('   -> keep existing (set ALTER_INDEXES=1 to drop & recreate)');
            continue;
          } else {
            console.log(`↻ options differ -> drop & recreate: ${t.coll}.${found.name} -> ${t.name}`);
            await col.dropIndex(found.name);
            const created = await col.createIndex(t.keys, { name: t.name, ...(t.options || {}) });
            console.log('   Created:', created);
            continue;
          }
        }

        // 名前だけ違う
        if (!nameSame) {
          if (rename) {
            console.log(`↻ rename by drop/create: ${t.coll}.${found.name} -> ${t.name}`);
            await col.dropIndex(found.name);
            const created = await col.createIndex(t.keys, { name: t.name, ...(t.options || {}) });
            console.log('   Created:', created);
          } else {
            console.log(`ℹ︎ exists with a different name on ${t.coll}: ${found.name} (keys match ${JSON.stringify(t.keys)})`);
            console.log('   -> keep existing (set RENAME_INDEXES=1 to unify name)');
          }
          continue;
        }
      } else {
        const created = await db.collection(t.coll).createIndex(t.keys, { name: t.name, ...(t.options || {}) });
        console.log('Created index:', t.coll, created);
      }
    }

    console.log('\nAll indexes after ensuring:');
    for (const g of ['customers','adminusers','queuehistories']) {
      try {
        const list = await db.collection(g).indexes();
        console.log('\n--', g, '--');
        console.table(list.map(({name, key, unique}) => ({ name, key: JSON.stringify(key), unique: !!unique })));
      } catch (e) {
        console.log('\n--', g, '-- (collection missing)');
      }
    }
  } finally {
    await client.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
