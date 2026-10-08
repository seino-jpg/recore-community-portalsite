// Gmail API でのメール送信（D2・D3）。送信元は community@ の OAuth（gmail.send だけ）。
//
// 環境変数（本番にだけ置く・D9）:
//   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET : OAuth クライアント（同意画面が「内部」のもの）
//   GMAIL_REFRESH_TOKEN                   : community@ が gmail.send を許可して得たトークン
//   MAIL_FROM                             : 送信元・返信先のアドレス（community@recore-corp.jp）
import { fetchWithTimeout } from './http.js';
import { SENDER_NAME } from './messages.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TIMEOUT_MS = 15000;

// アクセストークンは関数インスタンスの中で使い回す（期限の1分前に取り直す）
let cachedToken = null;

export function isGmailConfigured(env) {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.MAIL_FROM);
}

/** テスト用: 使い回しているアクセストークンを捨てる */
export function resetGmailTokenCache() {
  cachedToken = null;
}

/**
 * メールを1通送る。戻り値: { ok: true } または { ok: false, error, authError }
 * authError=true は認証切れ（invalid_grant 等）。トークンを入れ直すまで全件失敗する（D6）。
 * to はカンマ区切りの複数宛先も可。
 */
export async function sendMail(ctx, { to, subject, body }) {
  try {
    const token = await accessToken(ctx);
    if (!token.ok) return token;
    const raw = buildMime({ from: ctx.env.MAIL_FROM, to, subject, body });
    const res = await fetchWithTimeout(ctx.fetch, GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token.value, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw })
    }, TIMEOUT_MS);
    if (res.status === 401) {
      // アクセストークンが取り消された。次回は取り直す
      cachedToken = null;
      return { ok: false, authError: true, error: 'Gmail の認証が無効です（HTTP 401）' };
    }
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Gmail 送信に失敗（HTTP ${res.status}）${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Gmail 送信に失敗: ' + String(err && err.message || err) };
  }
}

async function accessToken(ctx) {
  const now = ctx.now();
  if (cachedToken && cachedToken.refreshToken === ctx.env.GMAIL_REFRESH_TOKEN && cachedToken.expiresAt - 60000 > now) {
    return { ok: true, value: cachedToken.value };
  }
  const res = await fetchWithTimeout(ctx.fetch, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ctx.env.GMAIL_CLIENT_ID,
      client_secret: ctx.env.GMAIL_CLIENT_SECRET,
      refresh_token: ctx.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString()
  }, TIMEOUT_MS);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body || !body.access_token) {
    const code = body && body.error ? String(body.error) : '';
    // invalid_grant: トークンの失効・取消。invalid_client: クライアントの削除・シークレット違い
    const authError = code === 'invalid_grant' || code === 'invalid_client' || code === 'unauthorized_client';
    return { ok: false, authError, error: `Gmail のトークン取得に失敗（HTTP ${res.status}${code ? ' ' + code : ''}）` };
  }
  cachedToken = {
    refreshToken: ctx.env.GMAIL_REFRESH_TOKEN,
    value: body.access_token,
    expiresAt: now + (Number(body.expires_in) || 3600) * 1000
  };
  return { ok: true, value: body.access_token };
}

/**
 * UTF-8 の text/plain メール（RFC 2822）を Gmail API の raw（base64url）にする。
 * 件名・差出人名は encoded-word、本文は base64。ヘッダーに改行を入れさせない。
 */
export function buildMime({ from, to, subject, body }) {
  const headers = [
    'From: ' + encodeWord(SENDER_NAME) + ' <' + oneLine(from) + '>',
    'To: ' + oneLine(to),
    'Reply-To: ' + oneLine(from),
    'Subject: ' + encodeWord(oneLine(subject)),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];
  const b64 = Buffer.from(String(body).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64');
  const message = headers.join('\r\n') + '\r\n\r\n' + b64.replace(/.{1,76}/g, '$&\r\n');
  return Buffer.from(message, 'utf8').toString('base64url');
}

function oneLine(v) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
}

// encoded-word は1語75文字まで。文字の途中で切らないよう、45バイト以内ずつに分けて折り返す
function encodeWord(text) {
  const words = [];
  let chunk = '';
  for (const ch of String(text)) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk || words.length === 0) words.push(chunk);
  return words.map((w) => '=?UTF-8?B?' + Buffer.from(w, 'utf8').toString('base64') + '?=').join('\r\n ');
}
