// シートの関東 Vol.4 タブ → DB の取り込み（D16・D17 ③）。
//   DATABASE_URL=<接続文字列> SPREADSHEET_ID=<ID> node scripts/import-sheet.mjs
// - source=sheet_import・通知済み（mail_sent_at / slack_sent_at を受付日時で埋める）・受付日時 JST→UTC
// - 履歴に action=import を残す
// - 何度実行しても二重にならない（行の内容から決めたトークンで ON CONFLICT DO NOTHING）
// - 関西タブは取り込まない（SHEET_TAB の既定は関東 Vol.4。EVENT_KEY を変えるときは意図して指定する）
import { neon } from '@neondatabase/serverless';
import { sheetConfig, readSheetRows, sheetRowToApplication } from './_sheet.mjs';

const IMPORT_ACTOR = 'sheet_import';
const eventKey = process.env.EVENT_KEY || 'kanto-vol4';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL を指定してください');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const cfg = sheetConfig();

const rows = await readSheetRows(cfg);
const apps = rows.map((r) => sheetRowToApplication(r, eventKey));   // 1行でも解釈できなければここで止まる
console.log(`シート「${cfg.tab}」: ${apps.length} 行`);

let inserted = 0;
let skipped = 0;
for (const a of apps) {
  const [row] = await sql`
    WITH ins AS (
      INSERT INTO applications
        (submission_token, event_key, event_name, company, representative_name, role, email, tel,
         attendees, car_count, message, source, received_at, mail_sent_at, slack_sent_at, notify_attempts)
      VALUES
        (${a.submission_token}, ${a.event_key}, ${a.event_name}, ${a.company}, ${a.representative_name}, ${a.role},
         ${a.email}, ${a.tel}, ${a.attendees}, ${a.car_count}, ${a.message}, 'sheet_import',
         ${a.received_at}::timestamptz, ${a.received_at}::timestamptz, ${a.received_at}::timestamptz, 1)
      ON CONFLICT (submission_token) DO NOTHING
      RETURNING id
    ), hist AS (
      INSERT INTO application_changes (application_id, changed_by, action, before, after)
      SELECT id, ${IMPORT_ACTOR}, 'import', NULL, ${JSON.stringify({ source: 'sheet_import', sheet_tab: cfg.tab })}::jsonb FROM ins
    )
    SELECT id FROM ins
  `;
  if (row) inserted++; else skipped++;
}
const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications WHERE event_key = ${eventKey} AND source = 'sheet_import'`;
console.log(`取り込み ${inserted} 行・既存のため見送り ${skipped} 行。DB の移行行: ${n} 行`);
