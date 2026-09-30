// 再送 Cron（U8・U10）と HTTP ハンドラの認証
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sql, resetDb, makeCtx, mockFetch, sampleInput, TEST_ENV } from './helpers.mjs';
import { handleApply } from '../api/_lib/apply-core.js';
import { runCron } from '../api/_lib/cron-core.js';
import cronHandler from '../api/cron-notify.js';
import applyHandler from '../api/apply.js';

beforeEach(resetDb);

test('U8 Cron が未通知の行を再送し、成功したら送信日時が入る', async () => {
  let gasDown = true;
  const fetch = mockFetch({ gas: () => { if (gasDown) throw new Error('down'); return { ok: true, mail: { ok: true }, slack: { ok: true } }; } });
  const ctx = makeCtx({ fetch });
  const a = await handleApply(ctx, sql, sampleInput());
  assert.equal(a.body.mailSent, false);

  // 落ちている間は試行回数だけ増える
  let r = await runCron(ctx, sql);
  assert.equal(r.processed, 1);
  let [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.notify_attempts, 2);
  assert.equal(row.mail_sent_at, null);

  gasDown = false;
  r = await runCron(ctx, sql);
  assert.equal(r.processed, 1);
  assert.equal(r.results[0].mailSent, true);
  [row] = await sql`SELECT * FROM applications`;
  assert.ok(row.mail_sent_at);
  assert.ok(row.slack_sent_at);
  assert.equal(row.notify_last_error, null);
  const hist = await sql`SELECT * FROM application_changes WHERE application_id = ${row.id} ORDER BY changed_at`;
  assert.equal(hist.length, 2);
  assert.ok(hist.every((h) => h.action === 'notify' && h.changed_by === 'cron'));

  // 送信済みになれば拾わない
  r = await runCron(ctx, sql);
  assert.equal(r.processed, 0);
});

test('U10 6回超過で Cron は止まり、行は未通知のまま残る（/admin の再送で拾える）', async () => {
  const fetch = mockFetch({ gas: () => { throw new Error('down'); } });
  const ctx = makeCtx({ fetch });
  await handleApply(ctx, sql, sampleInput());   // 1回目
  for (let i = 0; i < 10; i++) await runCron(ctx, sql);
  const [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.notify_attempts, 6);
  assert.equal(row.mail_sent_at, null);
  assert.equal(fetch.calls.gas.length, 6);
  assert.equal((await runCron(ctx, sql)).processed, 0);
});

test('Slack だけ未送信の行は Slack だけ頼む（メールを二重に送らない）', async () => {
  const fetch = mockFetch({ gas: (p) => ({ ok: true, mail: { ok: true }, slack: { ok: false, error: 'rate limited' } }) });
  const ctx = makeCtx({ fetch });
  await handleApply(ctx, sql, sampleInput());
  let [row] = await sql`SELECT * FROM applications`;
  assert.ok(row.mail_sent_at);
  assert.equal(row.slack_sent_at, null);
  assert.match(row.notify_last_error, /Slack: rate limited/);
  await runCron(ctx, sql);
  assert.deepEqual(fetch.calls.gas[1].send, { mail: false, slack: true });
});

test('取消した行・移行した行は Cron の対象外', async () => {
  const fetch = mockFetch({ gas: () => { throw new Error('down'); } });
  const ctx = makeCtx({ fetch });
  await handleApply(ctx, sql, sampleInput());
  await sql`UPDATE applications SET status = 'cancelled'`;
  await sql`INSERT INTO applications (submission_token, event_key, event_name, company, representative_name, role, email, tel, attendees, car_count, source, mail_sent_at, slack_sent_at)
            VALUES (gen_random_uuid(), 'kanto-vol4', 'x', 'c', 'n', 'r', 'a@example.com', '0', ARRAY['n'], 0, 'sheet_import', now(), now())`;
  assert.equal((await runCron(ctx, sql)).processed, 0);
});

test('GAS 設定なし（プレビュー）では Cron は何もしない', async () => {
  const fetch = mockFetch();
  const env = { ...TEST_ENV, GAS_URL: '', GAS_SHARED_SECRET: '' };
  await handleApply(makeCtx({ env, fetch }), sql, sampleInput());
  const r = await runCron(makeCtx({ env, fetch }), sql);
  assert.equal(r.skipped, true);
  assert.equal(fetch.calls.gas.length, 0);
});

// ---- HTTP ハンドラ（Vercel の (req, res) 形式）をローカルサーバーで ----
function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('Cron の HTTP 認証: CRON_SECRET の Bearer が無ければ 401、GET 以外は 405', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { ...TEST_ENV, GAS_URL: '', GAS_SHARED_SECRET: '' });
  const { server, port } = await serve(cronHandler);
  try {
    const base = `http://127.0.0.1:${port}/api/cron-notify`;
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(base, { method: 'POST', headers: { authorization: 'Bearer test-cron-secret' } })).status, 405);
    const ok = await fetch(base, { headers: { authorization: 'Bearer test-cron-secret' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).skipped, true);
    // CRON_SECRET 未設定なら誰も通さない
    delete process.env.CRON_SECRET;
    assert.equal((await fetch(base, { headers: { authorization: 'Bearer test-cron-secret' } })).status, 401);
  } finally {
    server.close();
    process.env = saved;
  }
});

test('申込 HTTP: text/plain の JSON 本文を受け、GET は 405、壊れた本文は 400', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { ...TEST_ENV, GAS_URL: '', GAS_SHARED_SECRET: '' });
  const { server, port } = await serve(applyHandler);
  try {
    const base = `http://127.0.0.1:${port}/api/apply`;
    assert.equal((await fetch(base)).status, 405);
    const bad = await fetch(base, { method: 'POST', body: '{not json' });
    assert.equal(bad.status, 400);
    const ok = await fetch(base, { method: 'POST', body: JSON.stringify(sampleInput()) });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.mailSent, false);
  } finally {
    server.close();
    process.env = saved;
  }
});
