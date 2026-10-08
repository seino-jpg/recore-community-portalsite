// Neon への接続。DATABASE_URL（プール接続）は Vercel の Neon 連携が入れる。
import { neon } from '@neondatabase/serverless';

let cached = null;

export function getSql(env = process.env) {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が未設定です');
  if (!cached || cached.url !== url) cached = { url, sql: neon(url) };
  return cached.sql;
}

// 申込行を API の応答・通知文面用の形にする（列名は DB のまま。人数は配列の長さ）
export function toApplicationView(row) {
  return {
    id: row.id,
    event_key: row.event_key,
    event_name: row.event_name,
    company: row.company,
    representative_name: row.representative_name,
    role: row.role,
    email: row.email,
    tel: row.tel,
    attendees: row.attendees,
    attendee_count: row.attendees.length,
    car_count: row.car_count,
    message: row.message,
    status: row.status,
    received_at: toIso(row.received_at),
    cancelled_at: toIso(row.cancelled_at),
    cancelled_by: row.cancelled_by,
    source: row.source,
    mail_sent_at: toIso(row.mail_sent_at),
    slack_sent_at: toIso(row.slack_sent_at),
    notify_attempts: row.notify_attempts,
    notify_last_error: row.notify_last_error,
    updated_at: toIso(row.updated_at)
  };
}

function toIso(v) {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

// JST 表示（シート・Slack と同じ yyyy/MM/dd HH:mm:ss）
export function formatJst(value, withSeconds = true) {
  const d = value instanceof Date ? value : new Date(value);
  const p = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  const hour = p.hour === '24' ? '00' : p.hour;
  const base = `${p.year}/${p.month}/${p.day} ${hour}:${p.minute}`;
  return withSeconds ? `${base}:${p.second}` : base;
}
