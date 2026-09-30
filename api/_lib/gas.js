// GAS（送信専用）への呼び出し（D10・D14）。
// 本文に共有シークレットを入れ、GAS は一致しないものを拒否する。
// GAS に渡すのは API が組み立てた申込1件とイベント表示値だけ（クライアントの本文は渡さない）。
//
// 環境変数（本番にだけ置く・D19）:
//   GAS_URL           : GAS Web アプリの URL
//   GAS_SHARED_SECRET : GAS スクリプトプロパティ SITE_SHARED_SECRET と同じ値
// どちらかが無ければ送らない（戻り値 sent=false, reason='not_configured'）。プレビューはこの状態で動く。

import { fetchWithTimeout } from './http.js';
import { formatJst } from './db.js';

const GAS_TIMEOUT_MS = 25000;

export function isGasConfigured(env) {
  return Boolean(env.GAS_URL && env.GAS_SHARED_SECRET);
}

/**
 * 申込通知（申込者へのメール・運営 Slack）を GAS に頼む。
 * send: { mail, slack } で未送信の分だけ頼む（再送で二重に送らない）。
 * 戻り値: { sent: true, mail: {ok, error}, slack: {ok, error} } または { sent: false, reason, error }
 */
export async function requestApplicationNotify(ctx, { application, event, send, duplicateEmail }) {
  return callGas(ctx, {
    action: 'notify_application',
    application: gasApplication(application),
    event,
    send: { mail: send.mail !== false, slack: send.slack !== false },
    notes: duplicateEmail ? ['同メールで申込あり'] : []
  });
}

/**
 * 取消・変更の通知（運営 Slack にだけ・D14）を GAS に頼む。
 * 戻り値: { sent: true, slack: {ok, error} } または { sent: false, reason, error }
 */
export async function requestChangeNotify(ctx, { type, application, event, changedBy, before, after }) {
  return callGas(ctx, {
    action: 'notify_change',
    type,
    application: gasApplication(application),
    event,
    changed_by: changedBy,
    before,
    after
  });
}

// GAS に渡す申込1件。受付日時は JST の表示文字列も添える（GAS 側で TZ 変換をしない）
function gasApplication(app) {
  return {
    id: app.id,
    company: app.company,
    representative_name: app.representative_name,
    role: app.role,
    email: app.email,
    tel: app.tel,
    attendees: app.attendees,
    car_count: app.car_count,
    message: app.message,
    event_name: app.event_name,
    received_at_jst: formatJst(app.received_at),
    received_at_jst_short: formatJst(app.received_at, false)
  };
}

async function callGas(ctx, payload) {
  if (!isGasConfigured(ctx.env)) {
    return { sent: false, reason: 'not_configured' };
  }
  try {
    // Content-Type は text/plain（GAS は JSON でも同じく postData.contents で受ける）
    const res = await fetchWithTimeout(ctx.fetch, ctx.env.GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: ctx.env.GAS_SHARED_SECRET, ...payload })
    }, GAS_TIMEOUT_MS);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    if (!res.ok || !body || typeof body !== 'object') {
      return { sent: false, reason: 'bad_response', error: `GAS が応答しません（HTTP ${res.status}）` };
    }
    if (!body.ok) {
      return { sent: false, reason: 'rejected', error: String(body.error || 'GAS がエラーを返しました') };
    }
    return { sent: true, mail: body.mail || null, slack: body.slack || null };
  } catch (err) {
    return { sent: false, reason: 'error', error: String(err && err.message || err) };
  }
}
