// 再送 Cron（旧設計 U8・U10／GAS 廃止の設計 U4・U5）と HTTP ハンドラの認証
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sql, resetDb, makeCtx, mockFetch, sampleInput, TEST_ENV, PREVIEW_ENV } from './helpers.mjs';
import { handleApply } from '../api/_lib/apply-core.js';
import { runCron } from '../api/_lib/cron-core.js';
import cronHandler from '../api/cron-notify.js';
import applyHandler from '../api/apply.js';

beforeEach(resetDb);

test('U8 Cron が未通知の行を再送し、成功したら送信日時が入る', async () => {
  let down = true;
  const fail = (ok) => () => { if (down) throw new Error('down'); return ok; };
  const fetch = mockFetch({ gmail: fail({ id: 'm' }), slack: fail({ ok: true }) });
  const ctx = makeCtx({ fetch });
  const a = await handleApply(ctx, sql, sampleInput());
  assert.equal(a.body.mailSent, false);

  // 落ちている間は試行回数だけ増える
  let r = await runCron(ctx, sql);
  assert.equal(r.processed, 1);
  let [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.notify_attempts, 2);
  assert.equal(row.mail_sent_at, null);

  down = false;
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

  // 届いたのは申込者1通と Slack 1件だけ
  assert.equal(fetch.calls.sent.length, 1);
  assert.equal(fetch.calls.sent[0].to, 'test@example.com');

  // 送信済みになれば拾わない
  r = await runCron(ctx, sql);
  assert.equal(r.processed, 0);
});

test('（新 U5）認証切れ → トークンを入れ直すと Cron の再送で届く。Slack の注記は最初の1回だけ', async () => {
  const fetch = mockFetch({
    oauth: (p) => (p.refresh_token === 'new-refresh-token'
      ? { access_token: 'new-access', expires_in: 3599 }
      : { status: 400, body: { error: 'invalid_grant' } })
  });
  const ctx = makeCtx({ fetch });
  await handleApply(ctx, sql, sampleInput());
  await runCron(ctx, sql);
  let [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.mail_sent_at, null);
  assert.ok(row.slack_sent_at);
  assert.equal(row.notify_attempts, 2);
  // Slack は申込時の1件だけ（Cron の再試行のたびに注記を流さない）
  assert.equal(fetch.calls.slack.length, 1);
  assert.match(fetch.calls.slack[0].text, /確認メールを送れていません/);

  const fixed = makeCtx({ fetch, env: { ...TEST_ENV, GMAIL_REFRESH_TOKEN: 'new-refresh-token' } });
  const r = await runCron(fixed, sql);
  assert.equal(r.results[0].mailSent, true);
  [row] = await sql`SELECT * FROM applications`;
  assert.ok(row.mail_sent_at);
  assert.equal(row.notify_last_error, null);
  assert.equal(fetch.calls.sent.length, 1);
  assert.equal(fetch.calls.sent[0].authorization, 'Bearer new-access');
  assert.equal(fetch.calls.slack.length, 1);
});

test('U10 6回超過で Cron は止まり、行は未通知のまま残る（/admin の再送で拾える）', async () => {
  const fetch = mockFetch({ gmail: () => { throw new Error('down'); }, slack: () => { throw new Error('down'); } });
  const ctx = makeCtx({ fetch });
  await handleApply(ctx, sql, sampleInput());   // 1回目
  for (let i = 0; i < 10; i++) await runCron(ctx, sql);
  const [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.notify_attempts, 6);
  assert.equal(row.mail_sent_at, null);
  assert.equal(fetch.calls.slack.length, 6);
  assert.equal((await runCron(ctx, sql)).processed, 0);
});

test('Slack だけ未送信の行は Slack だけ頼む（メールを二重に送らない）', async () => {
  // Slack も運営宛メールも失敗（申込者へのメールだけ届く）
  const fetch = mockFetch({
    slack: () => ({ ok: false, error: 'ratelimited' }),
    gmail: (m) => (m.to === 'test@example.com' ? { id: 'm' } : { status: 503, body: 'x' })
  });
  const ctx = makeCtx({ fetch });
  await handleApply(ctx, sql, sampleInput());
  let [row] = await sql`SELECT * FROM applications`;
  assert.ok(row.mail_sent_at);
  assert.equal(row.slack_sent_at, null);
  assert.match(row.notify_last_error, /Slack: Slack通知に失敗.*ratelimited/);
  await runCron(ctx, sql);
  // 再送では申込者へのメールを送らない（Slack と運営宛の切替だけ）
  assert.equal(fetch.calls.gmail.filter((m) => m.to === 'test@example.com').length, 1);
  assert.equal(fetch.calls.slack.length, 2);
});

test('取消した行・移行した行は Cron の対象外', async () => {
  const fetch = mockFetch({ gmail: () => { throw new Error('down'); }, slack: () => { throw new Error('down'); } });
  const ctx = makeCtx({ fetch });
  await handleApply(ctx, sql, sampleInput());
  await sql`UPDATE applications SET status = 'cancelled'`;
  await sql`INSERT INTO applications (submission_token, event_key, event_name, company, representative_name, role, email, tel, attendees, car_count, source, mail_sent_at, slack_sent_at)
            VALUES (gen_random_uuid(), 'kanto-vol4', 'x', 'c', 'n', 'r', 'a@example.com', '0', ARRAY['n'], 0, 'sheet_import', now(), now())`;
  assert.equal((await runCron(ctx, sql)).processed, 0);
});

test('通知の設定なし（プレビュー）では Cron は何もしない', async () => {
  const fetch = mockFetch();
  const env = PREVIEW_ENV;
  await handleApply(makeCtx({ env, fetch }), sql, sampleInput());
  const r = await runCron(makeCtx({ env, fetch }), sql);
  assert.equal(r.skipped, true);
  assert.equal(fetch.calls.oauth.length + fetch.calls.gmail.length + fetch.calls.slack.length, 0);
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
  Object.assign(process.env, PREVIEW_ENV);
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
  Object.assign(process.env, PREVIEW_ENV);
  const { server, port } = await serve(applyHandler);
  try {
    const base = `http://127.0.0.1:${port}/api/apply`;
    assert.equal((await fetch(base)).status, 405);
    const bad = await fetch(base, { method: 'POST', body: '{not json' });
    assert.equal(bad.status, 400);
    // 実行日に左右されないよう、締切が先のイベントで送る（関東 Vol.4 は 9/30 締切）
    const ok = await fetch(base, { method: 'POST', body: JSON.stringify(sampleInput({ eventKey: 'kansai-vol2' })) });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.equal(body.mailSent, false);
  } finally {
    server.close();
    process.env = saved;
  }
});
