// テスト共通。DB は検証用（.env.development.local の DATABASE_URL）、Google tokeninfo と GAS はモック。
import { readFileSync, existsSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

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

// 架空の設定値（実在のメール・ID・シークレットを書かない）
export const TEST_ENV = {
  DATABASE_URL: devEnv.DATABASE_URL,
  GAS_URL: 'https://gas.example.test/exec',
  GAS_SHARED_SECRET: 'test-shared-secret',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  ADMIN_EMAILS: 'editor@example.com, viewer@example.com',
  ADMIN_EDITOR_EMAILS: 'editor@example.com',
  CRON_SECRET: 'test-cron-secret'
};

export const TOKENINFO_PREFIX = 'https://oauth2.googleapis.com/tokeninfo?id_token=';

/**
 * fetch のモック。GAS と tokeninfo を URL で振り分ける。
 * gas: (payload) => 応答 JSON | { status, body } | throw
 * tokens: { [idToken]: tokeninfo の応答（status 省略時 200） }
 */
export function mockFetch({ gas, tokens = {} } = {}) {
  const calls = { gas: [], tokeninfo: [] };
  const fn = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(TOKENINFO_PREFIX)) {
      const token = decodeURIComponent(u.slice(TOKENINFO_PREFIX.length));
      calls.tokeninfo.push(token);
      const t = tokens[token];
      if (!t) return jsonResponse(400, { error: 'invalid_token' });
      return jsonResponse(t.status || 200, t.body || t);
    }
    if (u === TEST_ENV.GAS_URL) {
      const payload = JSON.parse(init.body);
      calls.gas.push(payload);
      if (!gas) return jsonResponse(200, { ok: true, mail: { ok: true }, slack: { ok: true } });
      const r = await gas(payload, init);
      if (r && typeof r.status === 'number' && 'body' in r) return jsonResponse(r.status, r.body);
      return jsonResponse(200, r);
    }
    throw new Error('unexpected fetch: ' + u);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
}

export function makeCtx({ env = TEST_ENV, fetch = mockFetch(), now = () => Date.parse('2026-09-28T12:00:00+09:00') } = {}) {
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
