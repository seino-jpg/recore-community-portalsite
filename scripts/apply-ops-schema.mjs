// db/ops-schema.sql（運営ボードの表）を DATABASE_URL の DB に適用する。何度流しても同じ結果になる。
//   DATABASE_URL=<接続文字列> node scripts/apply-ops-schema.mjs           表だけ
//   DATABASE_URL=<接続文字列> node scripts/apply-ops-schema.mjs --seed    表＋初期データ（行が無いときだけ入る）
// 接続先はコードに固定しない（本番・検証用の切替は環境変数で）。
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL を指定してください');
  process.exit(1);
}
const sql = neon(url);
const files = ['ops-schema.sql', ...(process.argv.includes('--seed') ? ['ops-seed.sql'] : [])];

for (const file of files) {
  const ddl = readFileSync(new URL(`../db/${file}`, import.meta.url), 'utf8');
  const statements = ddl
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
}
const [{ t }] = await sql`SELECT count(*)::int AS t FROM ops_tasks`;
const [{ s }] = await sql`SELECT count(*)::int AS s FROM ops_schedule`;
console.log(`ops schema applied (${files.join(' + ')}). ops_tasks: ${t} / ops_schedule: ${s}`);
