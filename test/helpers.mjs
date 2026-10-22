// テスト共通。DB は検証用（.env.development.local の DATABASE_URL）、Google（tokeninfo・OAuth・Gmail）と Slack はモック。
import { readFileSync, existsSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { GMAIL_SEND_URL, resetGmailTokenCache } from '../api/_lib/gmail.js';
import { SLACK_POST_URL } from '../api/_lib/slack.js';

export const ROOT = new URL('../', import.meta.url);

export function loadDevEnv() {
  const p = new URL('.env.development.local', ROOT);
  if (!existsSync(p)) throw new Error('.env.development.local がありません。vercel env pull --environment=development で作ってください');
  const env = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL がありません');
  if (/prod/i.test(env.PGDATABASE || '') ) throw new Error('本番らしい DB 名です。中止します');
  return env;
}

export const devEnv = loadDevEnv();
export const sql = neon(devEnv.DATABASE_URL);

export async function resetDb() {
  await sql`TRUNCATE application_changes, applications`;
}

// 架空の設定値（実在のメール・ID・シークレット・チャンネルを書かない）
export const TEST_ENV = {
  DATABASE_URL: devEnv.DATABASE_URL,
  GMAIL_CLIENT_ID: 'test-gmail-client.apps.googleusercontent.com',
  GMAIL_CLIENT_SECRET: 'test-gmail-secret',
  GMAIL_REFRESH_TOKEN: 'test-refresh-token',
  MAIL_FROM: 'community@example.com',
  OPERATOR_EMAILS: 'op1@example.com, op2@example.com',
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_CHANNEL_ID: 'CTEST',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  ADMIN_EMAILS: 'editor@example.com, viewer@example.com',
  ADMIN_EDITOR_EMAILS: 'editor@example.com',
  CRON_SECRET: 'test-cron-secret'
};

// 通知の設定を外した環境（プレビュー相当）
export const PREVIEW_ENV = {
  ...TEST_ENV,
  GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '', GMAIL_REFRESH_TOKEN: '', MAIL_FROM: '',
  OPERATOR_EMAILS: '', SLACK_BOT_TOKEN: '', SLACK_CHANNEL_ID: ''
};

export const TOKENINFO_PREFIX = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * fetch のモック。URL で振り分ける。各ハンドラは 応答 JSON | { status, body } | throw。
 * oauth: (params) => …   トークン取得（既定 access_token を返す）
 * gmail: (mail) => …     Gmail 送信（mail は復号したメール。既定 { id }）
 * slack: (payload) => …  chat.postMessage（既定 { ok: true }）
 * tokens: { [idToken]: tokeninfo の応答（status 省略時 200） }
 * calls.gmail は送ろうとした全メール（失敗も含む）。calls.sent は成功したものだけ。
 */
export function mockFetch({ oauth, gmail, slack, tokens = {} } = {}) {
  const calls = { tokeninfo: [], oauth: [], gmail: [], sent: [], slack: [] };
  const fn = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(TOKENINFO_PREFIX)) {
      const token = decodeURIComponent(u.slice(TOKENINFO_PREFIX.length));
      calls.tokeninfo.push(token);
      const t = tokens[token];
      if (!t) return jsonResponse(400, { error: 'invalid_token' });
      return jsonResponse(t.status || 200, t.body || t);
    }
    if (u === OAUTH_TOKEN_URL) {
      const params = Object.fromEntries(new URLSearchParams(String(init.body)));
      calls.oauth.push(params);
      return respond(oauth ? await oauth(params) : { access_token: 'test-access-token', expires_in: 3599 });
    }
    if (u === GMAIL_SEND_URL) {
      const mail = decodeMime(JSON.parse(init.body).raw);
      mail.authorization = init.headers.Authorization;
      calls.gmail.push(mail);
      const r = respond(gmail ? await gmail(mail) : { id: 'msg-' + calls.gmail.length });
      if (r.ok) calls.sent.push(mail);
      return r;
    }
    if (u === SLACK_POST_URL) {
      const payload = JSON.parse(init.body);
      payload.authorization = init.headers.Authorization;
      calls.slack.push(payload);
      return respond(slack ? await slack(payload) : { ok: true, ts: '1.0' });
    }
    throw new Error('unexpected fetch: ' + u);
  };
  fn.calls = calls;
  return fn;
}

function respond(r) {
  if (r && typeof r.status === 'number' && 'body' in r) return jsonResponse(r.status, r.body);
  return jsonResponse(200, r);
}

function jsonResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
}

/** Gmail API の raw（base64url）を { headers, from, to, replyTo, subject, body } に戻す */
export function decodeMime(raw) {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = text.indexOf('\r\n\r\n');
  const headerText = text.slice(0, sep).replace(/\r\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  // 隣り合う encoded-word の間の空白は捨てる（RFC 2047）。それ以外の空白は残す
  const decodeWords = (v) => v.replace(/(\?=)\s+(?==\?UTF-8\?B\?)/g, '$1').replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  return {
    headerText,
    headers,
    from: decodeWords(headers.from),
    to: headers.to,
    replyTo: headers['reply-to'],
    subject: decodeWords(headers.subject),
    body: Buffer.from(text.slice(sep + 4).replace(/\r\n/g, ''), 'base64').toString('utf8').replace(/\r\n/g, '\n')
  };
}

export function makeCtx({ env = TEST_ENV, fetch = mockFetch(), now = () => Date.parse('2026-09-28T12:00:00+09:00') } = {}) {
  // アクセストークンの使い回しをテストごとに捨てる（OAuth 呼び出し回数を確かめるため）
  resetGmailTokenCache();
  return { env, fetch, now };
}

export function sampleInput(overrides = {}) {
  return {
    submission_token: crypto.randomUUID(),
    eventKey: 'kanto-vol4',
    company: 'テスト株式会社',
    name: 'テスト 太郎',
    role: '経営者',
    email: 'test@example.com',
    tel: '090-0000-0000',
    attendeeCount: 3,
    attendees: ['テスト 太郎', 'テスト 花子', 'テスト 次郎'],
    carCount: 1,
    message: '',
    ...overrides
  };
}

// 有効期限内の架空トークン情報
export function tokenInfo(email, overrides = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: TEST_ENV.GOOGLE_CLIENT_ID,
    exp: String(Math.floor(Date.parse('2026-09-28T13:00:00+09:00') / 1000)),
    email_verified: 'true',
    email,
    ...overrides
  };
}
