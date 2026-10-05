// 運営 Slack への投稿（D5）。Bot トークンとチャンネルは GAS で使っていたものを移す。
//
// 環境変数（本番にだけ置く・D9）:
//   SLACK_BOT_TOKEN  : Bot トークン（GAS の SLACK_BOT_TOKEN と同じ値）
//   SLACK_CHANNEL_ID : 運営チャンネルの ID
import { fetchWithTimeout } from './http.js';

export const SLACK_POST_URL = 'https://slack.com/api/chat.postMessage';
const TIMEOUT_MS = 10000;

export function isSlackConfigured(env) {
  return Boolean(env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID);
}

/** 戻り値: { ok: true } または { ok: false, error } */
export async function postToSlack(ctx, text) {
  try {
    const res = await fetchWithTimeout(ctx.fetch, SLACK_POST_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ctx.env.SLACK_BOT_TOKEN, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: ctx.env.SLACK_CHANNEL_ID, text, unfurl_links: false })
    }, TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok || !body || !body.ok) {
      return { ok: false, error: 'Slack API error: ' + (body && body.error || 'HTTP ' + res.status) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Slack 送信に失敗: ' + String(err && err.message || err) };
  }
}
