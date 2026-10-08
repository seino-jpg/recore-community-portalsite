// 申込受付の本体（D4・D7・D9）。api/apply.js から呼ぶ。
// 戻り値: { status, body }
import { getEvent, isClosed } from './events.js';
import { validateApplication, isUuid } from './validate.js';
import { deliverNotification } from './notify.js';

export async function handleApply(ctx, sql, body) {
  const data = body && typeof body === 'object' ? body : null;
  if (!data) return reply(400, { ok: false, error: 'リクエスト本文がありません' });

  const source = 'site';
  const token = data.submission_token;
  if (!isUuid(token)) {
    return reply(400, { ok: false, error: '送信情報が不正です。ページを再読み込みしてお試しください' });
  }

  const ev = getEvent(data.eventKey);
  if (!ev) return reply(400, { ok: false, error: '対象のイベントが見つかりません' });
  if (isClosed(ev, ctx.now())) {
    return reply(400, { ok: false, code: 'closed', error: '申込受付は終了しました' });
  }

  const v = validateApplication(data);
  if (!v.ok) return reply(400, { ok: false, error: v.error });
  const r = v.record;

  let row;
  try {
    const inserted = await sql`
      INSERT INTO applications
        (submission_token, event_key, event_name, company, representative_name, role, email, tel,
         attendees, car_count, message, source, received_at)
      VALUES
        (${token}, ${ev.key}, ${ev.name}, ${r.company}, ${r.name}, ${r.role}, ${r.email}, ${r.tel},
         ${r.attendees}, ${r.carCount}, ${r.message}, ${source}, ${new Date(ctx.now()).toISOString()}::timestamptz)
      ON CONFLICT (submission_token) DO NOTHING
      RETURNING *
    `;
    if (inserted.length === 0) {
      // 同じトークンの再送（連打・リトライ）。保存せず同じ結果を返す（U3）
      const [existing] = await sql`SELECT * FROM applications WHERE submission_token = ${token}`;
      return reply(200, { ok: true, id: existing.id, mailSent: existing.mail_sent_at != null, duplicate: true });
    }
    row = inserted[0];
  } catch (err) {
    console.error('DB 保存に失敗', err);
    return reply(500, { ok: false, error: '送信に失敗しました' });
  }

  // 保存できた時点で申込は成立。通知は失敗しても Cron が再送する
  let mailSent = false;
  try {
    const n = await deliverNotification(ctx, sql, row, { changedBy: 'apply', recordHistory: false });
    mailSent = n.mailSent;
  } catch (err) {
    console.error('通知に失敗', err);
  }
  return reply(200, { ok: true, id: row.id, mailSent });
}

function reply(status, body) {
  return { status, body };
}
