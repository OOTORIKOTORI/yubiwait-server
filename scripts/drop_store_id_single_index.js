// drop_store_id_single_index.js — queuehistories の冗長インデックスを削除（安全・冪等）
// 目的: 複合 { store_id:1, completed_at:-1 } が存在する前提で、単一 index 'store_id_1' をドロップします。
// Usage:
//   MONGODB_URI="mongodb://localhost:27017/yourdb" node scripts/drop_store_id_single_index.js
//
// オプション:
//   DRY_RUN=1  -> 実際には削除せず、削除対象かどうかだけ表示
//   FORCE=1    -> 複合インデックスが無くても強制ドロップ（通常は推奨しません）
//
// 返却: 標準出力に結果ログを表示し、最後に全インデックス一覧を表示します。

require('dotenv').config();
const { MongoClient } = require('mongodb');

const TARGET_COLL = 'queuehistories';
const REDUNDANT_NAME = 'store_id_1';
const REQUIRED_COMPOSITE = { store_id: 1, completed_at: -1 }; // プレフィックスで store_id を包含

const sameKeys = (a, b) => {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    const k = ak[i];
    if (k !== bk[i]) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
};

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('ERROR: MONGODB_URI is required'); process.exit(1); }

  const DRY_RUN = process.env.DRY_RUN === '1';
  const FORCE = process.env.FORCE === '1';

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const parsed = new URL(uri);
    const dbName = (parsed.pathname && parsed.pathname.replace(/^\//,'')) || 'test';
    const db = client.db(dbName);
    const col = db.collection(TARGET_COLL);

    let indexes;
    try {
      indexes = await col.indexes();
    } catch (e) {
      console.error(`ERROR: collection "${TARGET_COLL}" not found or cannot list indexes.`);
      throw e;
    }

    const hasSingle = indexes.find(ix => ix.name === REDUNDANT_NAME);
    const composite = indexes.find(ix => sameKeys(ix.key, REQUIRED_COMPOSITE));
    const hasComposite = !!composite;

    console.log('Current indexes:');
    console.table(indexes.map(({name, key, unique}) => ({ name, key: JSON.stringify(key), unique: !!unique })));

    if (!hasSingle) {
      console.log(`✓ "${REDUNDANT_NAME}" does not exist. Nothing to do.`);
      return;
    }

    if (!hasComposite && !FORCE) {
      console.log(`⚠ "${REDUNDANT_NAME}" exists, but required composite ${JSON.stringify(REQUIRED_COMPOSITE)} was NOT found.`);
      console.log('  -> Abort (set FORCE=1 to drop anyway).');
      return;
    }

    if (DRY_RUN) {
      console.log(`DRY_RUN: would drop index "${REDUNDANT_NAME}" on "${TARGET_COLL}".`);
      return;
    }

    console.log(`Dropping "${REDUNDANT_NAME}" on "${TARGET_COLL}" ...`);
    const res = await col.dropIndex(REDUNDANT_NAME);
    console.log('dropIndex result:', res);

    const after = await col.indexes();
    console.log('\nIndexes after drop:');
    console.table(after.map(({name, key, unique}) => ({ name, key: JSON.stringify(key), unique: !!unique })));

    console.log('\nDONE ✅');
  } finally {
    await client.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
