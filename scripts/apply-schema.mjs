// db/schema.sql を DATABASE_URL の DB に適用する。何度流しても同じ結果になる。
//   DATABASE_URL=<接続文字列> node scripts/apply-schema.mjs
// 接続先はコードに固定しない（本番・検証用の切替は環境変数で）。
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL を指定してください');
  process.exit(1);
}
const sql = neon(url);
const ddl = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const statements = ddl
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

for (const stmt of statements) {
  await sql.query(stmt);
}
const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications`;
console.log(`schema applied. applications rows: ${n}`);
