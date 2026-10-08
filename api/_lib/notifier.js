// 申込・取消・変更の通知を送る（D1・D4〜D6）。GAS の代わりにサイトから直接送る。
// 申込者へのメール → 運営 Slack の順。Slack が失敗したら運営宛メールに切り替える。
//
// 環境変数（本番にだけ置く・D9。どれかが無ければ送らない＝プレビュー）:
//   Gmail（gmail.js）・Slack（slack.js）の設定
//   OPERATOR_EMAILS : 運営宛メールの宛先（カンマ区切り。community@ を経由しない・D4）
import { isGmailConfigured, sendMail } from './gmail.js';
import { isSlackConfigured, postToSlack } from './slack.js';
import {
  toRecord, confirmationMail, operatorApplicationMail, operatorTextMail,
  applicationSlackText, changeSlackText, changeSubject
} from './messages.js';

export const MAIL_AUTH_NOTE = '確認メールを送れていません（メール送信の認証が切れています）';

export function isNotifyConfigured(env) {
  return isGmailConfigured(env) && isSlackConfigured(env) && Boolean(env.OPERATOR_EMAILS);
}

/**
 * 申込通知（申込者へのメール・運営 Slack）。send: { mail, slack } で未送信の分だけ送る（再送で二重に送らない）。
 * 戻り値: { sent: true, mail: {ok, error, authError}, slack: {ok, error, fallback} } または { sent: false, reason }
 */
export async function sendApplicationNotify(ctx, { application, event, send, duplicateEmail }) {
  if (!isNotifyConfigured(ctx.env)) return { sent: false, reason: 'not_configured' };
  const record = toRecord(application, event);
  const result = { sent: true, mail: { ok: false, skipped: true }, slack: { ok: false, skipped: true } };

  if (send.mail !== false) {
    const m = confirmationMail(record, ctx.env.MAIL_FROM);
    result.mail = await sendMail(ctx, { to: record.email, subject: m.subject, body: m.body });
  }
  if (send.slack !== false) {
    const notes = duplicateEmail ? ['同メールで申込あり'] : [];
    // 認証切れは全件に効くので、運営が気づけるよう申込の通知に添える（D6）
    if (result.mail.authError) notes.push(MAIL_AUTH_NOTE);
    result.slack = await notifyOperators(ctx, applicationSlackText(record, notes), (reason) => operatorApplicationMail(record, reason));
  }
  return result;
}

/**
 * 取消・変更の通知。運営 Slack にだけ送る（旧 D14）。
 * 戻り値: { sent: true, slack: {ok, error, fallback} } または { sent: false, reason, error }
 */
export async function sendChangeNotify(ctx, { type, application, event, changedBy, before, after }) {
  if (!isNotifyConfigured(ctx.env)) return { sent: false, reason: 'not_configured' };
  if (type !== 'cancel' && type !== 'update') return { sent: false, reason: 'rejected', error: '不明な type です: ' + type };
  const record = toRecord(application, event);
  const text = changeSlackText(type, record, changedBy, before, after);
  const subject = changeSubject(type, record);
  return { sent: true, slack: await notifyOperators(ctx, text, (reason) => operatorTextMail(subject, text, reason)) };
}

// Slack に投稿し、失敗したら運営宛メールに切り替える。メールで届いたときは ok=true・fallback='mail'
async function notifyOperators(ctx, text, fallbackMail) {
  const s = await postToSlack(ctx, text);
  if (s.ok) return { ok: true };
  const reason = 'Slack通知に失敗したためメールで通知しています（' + s.error + '）。';
  const m = fallbackMail(reason);
  const r = await sendMail(ctx, { to: ctx.env.OPERATOR_EMAILS, subject: m.subject, body: m.body });
  if (r.ok) return { ok: true, fallback: 'mail', error: reason };
  return { ok: false, error: reason + ' さらにメールも失敗（' + r.error + '）' };
}
