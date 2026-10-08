// /admin 向け API の本体（D5・D6・D8・D12〜D14）。api/admin.js から呼ぶ。
// 戻り値: { status, body }
import { authenticateAdmin } from './auth.js';
import { listEvents, getEvent, eventDisplay } from './events.js';
import { toApplicationView } from './db.js';
import { normalizeAttendees, isUuid } from './validate.js';
import { deliverNotification } from './notify.js';
import { sendChangeNotify } from './notifier.js';

export async function handleAdmin(ctx, sql, body) {
  const data = body && typeof body === 'object' ? body : {};
  const auth = await authenticateAdmin(data.idToken, ctx);
  if (!auth.ok) return reply(403, { ok: false, error: auth.error });

  const action = String(data.action || '');
  if (action === 'list') {
    return reply(200, { ok: true, viewer: auth.email, canEdit: auth.canEdit, events: await listAll(sql) });
  }

  if (action === 'cancel' || action === 'update' || action === 'resend') {
    // 書き込みは編集の許可リストだけ（D13）。画面を改変しても API で止める（U18b）
    if (!auth.canEdit) return reply(403, { ok: false, error: 'この操作の権限がありません' });
    if (!isUuid(data.id)) return reply(400, { ok: false, error: '対象が指定されていません' });
    if (action === 'cancel') return cancel(ctx, sql, data.id, auth.email);
    if (action === 'update') return update(ctx, sql, data, auth.email);
    return resend(ctx, sql, data.id, auth.email);
  }
  return reply(400, { ok: false, error: '不明な action です: ' + action });
}

// 集計は有効行のみ（D5）。人数は attendees の長さ
export function summarize(rows, capacity) {
  const active = rows.filter((r) => r.status === 'active');
  const attendees = active.reduce((s, r) => s + r.attendees.length, 0);
  const cars = active.reduce((s, r) => s + r.car_count, 0);
  return {
    companies: active.length,
    attendees,
    cars,
    capacity: capacity ?? null,
    remaining: capacity == null ? null : capacity - attendees,
    pending: active.filter((r) => !r.mail_sent_at || !r.slack_sent_at).length
  };
}

async function listAll(sql) {
  const rows = await sql`SELECT * FROM applications ORDER BY received_at, id`;
  return listEvents().map((ev) => {
    const mine = rows.filter((r) => r.event_key === ev.key);
    return {
      key: ev.key,
      name: ev.name,
      capacity: ev.capacity ?? null,
      summary: summarize(mine, ev.capacity),
      rows: mine.map(toApplicationView)
    };
  });
}

async function eventSummary(sql, eventKey) {
  const ev = getEvent(eventKey);
  const rows = await sql`SELECT * FROM applications WHERE event_key = ${eventKey}`;
  return summarize(rows, ev ? ev.capacity : null);
}

async function cancel(ctx, sql, id, actor) {
  const [before] = await sql`SELECT * FROM applications WHERE id = ${id}`;
  if (!before) return reply(404, { ok: false, error: '申込が見つかりません' });
  if (before.status !== 'active') return reply(409, { ok: false, error: 'すでに取り消されています' });

  const nowIso = new Date(ctx.now()).toISOString();
  // 更新と履歴を1文で。有効行でなければ何も起きない（取消行は編集しない・U18）
  const [row] = await sql`
    WITH upd AS (
      UPDATE applications
      SET status = 'cancelled', cancelled_at = ${nowIso}::timestamptz, cancelled_by = ${actor}, updated_at = now()
      WHERE id = ${id} AND status = 'active'
      RETURNING *
    ), hist AS (
      INSERT INTO application_changes (application_id, changed_by, action, before, after)
      SELECT id, ${actor}, 'cancel',
        jsonb_build_object('status', 'active'),
        jsonb_build_object('status', 'cancelled', 'cancelled_at', cancelled_at, 'cancelled_by', cancelled_by)
      FROM upd
    )
    SELECT * FROM upd
  `;
  if (!row) return reply(409, { ok: false, error: 'すでに取り消されています' });

  const notified = await notifyChange(ctx, 'cancel', row, actor,
    { status: 'active' }, { status: 'cancelled' });
  return reply(200, { ok: true, application: toApplicationView(row), summary: await eventSummary(sql, row.event_key), notified });
}

async function update(ctx, sql, data, actor) {
  const [before] = await sql`SELECT * FROM applications WHERE id = ${data.id}`;
  if (!before) return reply(404, { ok: false, error: '申込が見つかりません' });
  if (before.status !== 'active') return reply(409, { ok: false, error: '取り消した申込は変更できません' });

  // 変えられるのは参加者氏名（＝人数）・台数・ご要望だけ（D13）
  const attendees = data.attendees === undefined ? before.attendees : normalizeAttendees(data.attendees);
  const carCount = data.carCount === undefined ? before.car_count : parseInt(data.carCount, 10);
  const message = data.message === undefined ? before.message : String(data.message ?? '').trim();
  if (attendees.length < 1) return reply(400, { ok: false, error: '参加者氏名を1名以上入力してください' });
  if (!(carCount >= 0 && carCount <= 5)) return reply(400, { ok: false, error: 'お車の台数は0〜5台で入力してください' });

  const changedBefore = {};
  const changedAfter = {};
  if (JSON.stringify(attendees) !== JSON.stringify(before.attendees)) {
    changedBefore.attendees = before.attendees; changedAfter.attendees = attendees;
  }
  if (carCount !== before.car_count) { changedBefore.car_count = before.car_count; changedAfter.car_count = carCount; }
  if (message !== before.message) { changedBefore.message = before.message; changedAfter.message = message; }
  if (Object.keys(changedAfter).length === 0) return reply(400, { ok: false, error: '変更がありません' });

  const [row] = await sql`
    WITH upd AS (
      UPDATE applications
      SET attendees = ${attendees}, car_count = ${carCount}, message = ${message}, updated_at = now()
      WHERE id = ${data.id} AND status = 'active'
      RETURNING *
    ), hist AS (
      INSERT INTO application_changes (application_id, changed_by, action, before, after)
      SELECT id, ${actor}, 'update', ${JSON.stringify(changedBefore)}::jsonb, ${JSON.stringify(changedAfter)}::jsonb
      FROM upd
    )
    SELECT * FROM upd
  `;
  if (!row) return reply(409, { ok: false, error: '取り消した申込は変更できません' });

  const notified = await notifyChange(ctx, 'update', row, actor, changedBefore, changedAfter);
  return reply(200, { ok: true, application: toApplicationView(row), summary: await eventSummary(sql, row.event_key), notified });
}

async function resend(ctx, sql, id, actor) {
  const [row] = await sql`SELECT * FROM applications WHERE id = ${id}`;
  if (!row) return reply(404, { ok: false, error: '申込が見つかりません' });
  if (row.status !== 'active') return reply(409, { ok: false, error: '取り消した申込には通知しません' });
  if (row.mail_sent_at && row.slack_sent_at) return reply(400, { ok: false, error: '通知は送信済みです' });

  const n = await deliverNotification(ctx, sql, row, { changedBy: actor, recordHistory: true });
  return reply(200, {
    ok: true,
    mailSent: n.mailSent,
    slackSent: n.slackSent,
    error: n.error,
    application: n.application,
    summary: await eventSummary(sql, row.event_key)
  });
}

// 変更・取消は運営 Slack にだけ通知（D14）。失敗しても操作は成立している
async function notifyChange(ctx, type, row, actor, before, after) {
  try {
    const ev = getEvent(row.event_key);
    const r = await sendChangeNotify(ctx, {
      type,
      application: toApplicationView(row),
      event: ev ? eventDisplay(ev) : { name: row.event_name },
      changedBy: actor,
      before,
      after
    });
    return Boolean(r.sent && r.slack && r.slack.ok);
  } catch (err) {
    console.error('変更通知に失敗', err);
    return false;
  }
}

function reply(status, body) {
  return { status, body };
}
