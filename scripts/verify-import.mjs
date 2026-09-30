// 取り込みの突き合わせ（D18・D17 ④）。1件でも違えば終了コード 1。
//   DATABASE_URL=<接続文字列> SPREADSHEET_ID=<ID> node scripts/verify-import.mjs
// 比べるもの:
//   - 行数: シートのデータ行数 ＝ DB の移行行（source=sheet_import）数
//   - 全行の値: 会社名・メール・電話番号（原文）・人数・台数・受付日時（JST 表示）
//   - 集計: シート由来の社数・人数・台数 ＝ DB の移行行（有効）の集計
import { neon } from '@neondatabase/serverless';
import { sheetConfig, readSheetRows, sheetRowToApplication } from './_sheet.mjs';
import { formatJst } from '../api/_lib/db.js';
import { summarize } from '../api/_lib/admin-core.js';

const eventKey = process.env.EVENT_KEY || 'kanto-vol4';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL を指定してください');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const cfg = sheetConfig();

const sheetRows = await readSheetRows(cfg);
const expected = sheetRows.map((r) => sheetRowToApplication(r, eventKey));
const dbRows = await sql`SELECT * FROM applications WHERE event_key = ${eventKey} AND source = 'sheet_import' ORDER BY received_at, id`;

const problems = [];
if (expected.length !== dbRows.length) {
  problems.push(`行数が違います: シート ${expected.length} 行 / DB ${dbRows.length} 行`);
}

const byToken = new Map(dbRows.map((r) => [r.submission_token, r]));
const keys = ['company', 'email', 'tel', 'attendee_count', 'car_count', 'received_at_jst'];
for (const e of expected) {
  const d = byToken.get(e.submission_token);
  const label = `シート行 ${e.received_at ? formatJst(e.received_at) : '?'}`;
  if (!d) { problems.push(`${label}: DB に無い`); continue; }
  const ev = { company: e.company, email: e.email, tel: e.tel, attendee_count: e.attendees.length, car_count: e.car_count, received_at_jst: formatJst(e.received_at) };
  const dv = { company: d.company, email: d.email, tel: d.tel, attendee_count: d.attendees.length, car_count: d.car_count, received_at_jst: formatJst(d.received_at) };
  for (const k of keys) {
    if (ev[k] !== dv[k]) problems.push(`${label}: ${k} が違う（シート=${JSON.stringify(ev[k])} / DB=${JSON.stringify(dv[k])}）`);
  }
  // 受付日時の表示がシートの原文と一致するか（秒あり・ゼロ埋めの差は正規化して比べる）
  const raw = sheetRows[expected.indexOf(e)]['受付日時'];
  if (normalizeJst(raw) !== dv.received_at_jst) problems.push(`${label}: 受付日時の表示が違う（シート=${raw} / DB=${dv.received_at_jst}）`);
}
for (const d of dbRows) {
  if (!expected.some((e) => e.submission_token === d.submission_token)) problems.push(`DB 行 ${formatJst(d.received_at)} ${d.company}: シートに無い`);
}

// 集計（/admin と同じ summarize）
const sheetSummary = {
  companies: expected.length,
  attendees: expected.reduce((s, e) => s + e.attendees.length, 0),
  cars: expected.reduce((s, e) => s + e.car_count, 0)
};
const dbSummary = summarize(dbRows, null);
for (const k of ['companies', 'attendees', 'cars']) {
  if (sheetSummary[k] !== dbSummary[k]) problems.push(`集計 ${k} が違う（シート=${sheetSummary[k]} / DB=${dbSummary[k]}）`);
}

console.log(`シート「${cfg.tab}」${expected.length} 行 / DB 移行行 ${dbRows.length} 行`);
console.log(`集計: 社数 ${sheetSummary.companies} / 人数 ${sheetSummary.attendees} / 台数 ${sheetSummary.cars}（DB: ${dbSummary.companies} / ${dbSummary.attendees} / ${dbSummary.cars}）`);
if (problems.length) {
  console.error('不一致:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log('一致: 行数・全行の値・集計');

function normalizeJst(text) {
  const m = String(text).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return text;
  const pad = (v) => String(v).padStart(2, '0');
  return `${m[1]}/${pad(m[2])}/${pad(m[3])} ${pad(m[4])}:${m[5]}:${m[6] || '00'}`;
}
