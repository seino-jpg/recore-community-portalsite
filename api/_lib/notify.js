// 申込通知の配送と通知状態の更新（D7・D8）。申込時・Cron・/admin の再送が同じ処理を通る。
import { getEvent, eventDisplay } from './events.js';
import { sendApplicationNotify } from './notifier.js';
import { toApplicationView } from './db.js';

export const MAX_NOTIFY_ATTEMPTS = 6;
export const CRON_ACTOR = 'cron';

/**
 * 未送信の分（メール・Slack）だけ送り、結果を行に書く。
 * recordHistory=true のとき（Cron・再送）は履歴に action=notify を残す。
 * 戻り値: { mailSent, slackSent, error, application }
 */
export async function deliverNotification(ctx, sql, row, { changedBy, recordHistory }) {
  const ev = getEvent(row.event_key);
  const send = { mail: !row.mail_sent_at, slack: !row.slack_sent_at };
  if (!send.mail && !send.slack) {
    return { mailSent: true, slackSent: true, error: null, application: toApplicationView(row) };
  }

  const [dup] = await sql`
    SELECT count(*)::int AS n FROM applications
    WHERE event_key = ${row.event_key} AND lower(email) = lower(${row.email}) AND id <> ${row.id}
  `;

  const result = await sendApplicationNotify(ctx, {
    application: toApplicationView(row),
    // 未知のキーは DB に入らない前提だが、念のため時点値で埋める
    event: ev ? eventDisplay(ev) : { name: row.event_name, date_text: '', place: '', detail: '' },
    send,
    duplicateEmail: dup.n > 0
  });

  let mailOk = !send.mail;
  let slackOk = !send.slack;
  let error = null;
  if (result.sent) {
    if (send.mail) mailOk = Boolean(result.mail && result.mail.ok);
    if (send.slack) slackOk = Boolean(result.slack && result.slack.ok);
    const errors = [];
    if (send.mail && !mailOk) errors.push('メール: ' + (result.mail && result.mail.error || '失敗'));
    if (send.slack && !slackOk) errors.push('Slack: ' + (result.slack && result.slack.error || '失敗'));
    // Slack の代わりにメールで届いたときも、切り替えた理由を残す（U3）
    if (send.slack && slackOk && result.slack.fallback) errors.push('Slack: ' + result.slack.error);
    error = errors.length ? errors.join(' / ') : null;
  } else if (result.reason === 'not_configured') {
    // プレビュー等。行は未通知のまま、試行回数も増やさない（D19）
    return { mailSent: false, slackSent: false, error: null, application: toApplicationView(row), skipped: true };
  } else {
    error = result.error || '通知を送れませんでした';
  }

  const nowIso = new Date(ctx.now()).toISOString();
  const [updated] = await sql`
    UPDATE applications SET
      mail_sent_at = CASE WHEN ${mailOk} AND mail_sent_at IS NULL THEN ${nowIso}::timestamptz ELSE mail_sent_at END,
      slack_sent_at = CASE WHEN ${slackOk} AND slack_sent_at IS NULL THEN ${nowIso}::timestamptz ELSE slack_sent_at END,
      notify_attempts = notify_attempts + 1,
      notify_last_error = ${error},
      updated_at = now()
    WHERE id = ${row.id}
    RETURNING *
  `;

  if (recordHistory) {
    await sql`
      INSERT INTO application_changes (application_id, changed_by, action, before, after)
      VALUES (${row.id}, ${changedBy}, 'notify',
        ${JSON.stringify({ mail_sent_at: row.mail_sent_at, slack_sent_at: row.slack_sent_at, notify_attempts: row.notify_attempts })}::jsonb,
        ${JSON.stringify({ mail_sent_at: updated.mail_sent_at, slack_sent_at: updated.slack_sent_at, notify_attempts: updated.notify_attempts, error })}::jsonb)
    `;
  }

  return { mailSent: mailOk, slackSent: slackOk, error, application: toApplicationView(updated) };
}

// Cron が拾う対象: 有効行で未通知・試行 6 回未満。移行行は通知済みで入るので条件上含まれない
// 運営登録（source = 'admin'）は宛先のメールが無く、申込通知を送らない（attendee-category D26）
export async function findPendingForCron(sql, limit = 20) {
  return sql`
    SELECT * FROM applications
    WHERE status = 'active'
      AND source <> 'admin'
      AND (mail_sent_at IS NULL OR slack_sent_at IS NULL)
      AND notify_attempts < ${MAX_NOTIFY_ATTEMPTS}
    ORDER BY received_at
    LIMIT ${limit}
  `;
}
