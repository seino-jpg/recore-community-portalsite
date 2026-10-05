// 申込 API（旧設計 U1〜U8・U11・U23・U24・U26／GAS 廃止の設計 U1・U3・U4・U7・U9）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql, resetDb, makeCtx, mockFetch, sampleInput, PREVIEW_ENV } from './helpers.mjs';
import { handleApply } from '../api/_lib/apply-core.js';

beforeEach(resetDb);

test('U1 通常の申込: DB に1行（source=site）・メール・Slack 送信・送信日時', async () => {
  const fetch = mockFetch();
  const ctx = makeCtx({ fetch });
  const r = await handleApply(ctx, sql, sampleInput());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mailSent, true);

  const rows = await sql`SELECT * FROM applications`;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.source, 'site');
  assert.equal(row.event_name, '関東コミュニティ第4回イベント（ブックオフ出品倉庫 見学会）');
  assert.deepEqual(row.attendees, ['テスト 太郎', 'テスト 花子', 'テスト 次郎']);
  assert.equal(row.car_count, 1);
  assert.equal(row.status, 'active');
  assert.ok(row.mail_sent_at);
  assert.ok(row.slack_sent_at);
  assert.equal(row.notify_attempts, 1);
  assert.equal(row.notify_last_error, null);

  // 申込者へのメール1通（community@ から・返信先 community@）と運営 Slack 1件
  assert.equal(fetch.calls.sent.length, 1);
  const m = fetch.calls.sent[0];
  assert.equal(m.to, 'test@example.com');
  assert.equal(m.from, 'RECOREコミュニティ事務局 <community@example.com>');
  assert.equal(m.replyTo, 'community@example.com');
  assert.equal(m.subject, '【RECOREコミュニティ】お申し込みを受け付けました');
  assert.equal(m.authorization, 'Bearer test-access-token');
  // イベント表示値は events.json から（クライアントの本文は使わない）
  assert.match(m.body, /【開催場所】\n東名横浜ロジスティクスセンター（神奈川県横浜市瀬谷区北町25-9）/);
  assert.match(m.body, /参加者：テスト 太郎、テスト 花子、テスト 次郎/);
  assert.match(m.body, /RECOREコミュニティ事務局\ncommunity@example.com\nhttps:\/\/recore-community-portalsite.vercel.app\/$/);
  assert.equal(fetch.calls.slack.length, 1);
  const s = fetch.calls.slack[0];
  assert.equal(s.channel, 'CTEST');
  assert.equal(s.authorization, 'Bearer xoxb-test');
  assert.match(s.text, /^\*【イベント申し込み】\* 関東コミュニティ第4回イベント/);
  assert.match(s.text, /\*受付日時：\* 2026\/09\/28 12:00\n/);
  assert.doesNotMatch(s.text, /※/);
});

test('U2 電話番号の保持: 090…・+81…・ハイフンあり が原文のまま', async () => {
  const fetch = mockFetch();
  const ctx = makeCtx({ fetch });
  for (const tel of ['09000000000', '+819000000000', '03-0000-0000']) {
    const r = await handleApply(ctx, sql, sampleInput({ tel }));
    assert.equal(r.body.ok, true);
  }
  const rows = await sql`SELECT tel FROM applications ORDER BY received_at, id`;
  assert.deepEqual(rows.map((r) => r.tel).sort(), ['+819000000000', '03-0000-0000', '09000000000']);
  assert.deepEqual(fetch.calls.sent.map((m) => m.body.match(/電話番号：(.*)/)[1]).sort(), ['+819000000000', '03-0000-0000', '09000000000']);
  assert.deepEqual(fetch.calls.slack.map((p) => p.text.match(/\*電話番号：\* (.*)/)[1]).sort(), ['+819000000000', '03-0000-0000', '09000000000']);
});

test('U3 連打・リトライ: 同じ token で2回届いても DB は1行・メールは1通・2回目も受付完了', async () => {
  const fetch = mockFetch();
  const ctx = makeCtx({ fetch });
  const input = sampleInput();
  const r1 = await handleApply(ctx, sql, input);
  const r2 = await handleApply(ctx, sql, input);
  assert.equal(r1.body.ok, true);
  assert.equal(r2.body.ok, true);
  assert.equal(r2.body.mailSent, true);
  assert.equal(r2.body.duplicate, true);
  assert.equal(r1.body.id, r2.body.id);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications`;
  assert.equal(n, 1);
  assert.equal(fetch.calls.sent.length, 1);
  assert.equal(fetch.calls.slack.length, 1);
});

test('U4 同じメールで2件目: 2行とも保存・Slack に「同メールで申込あり」注記', async () => {
  const fetch = mockFetch();
  const ctx = makeCtx({ fetch });
  await handleApply(ctx, sql, sampleInput());
  const r = await handleApply(ctx, sql, sampleInput({ email: 'TEST@example.com', attendeeCount: 1, attendees: ['テスト 太郎'] }));
  assert.equal(r.body.ok, true);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications`;
  assert.equal(n, 2);
  assert.doesNotMatch(fetch.calls.slack[0].text, /同メールで申込あり/);
  assert.match(fetch.calls.slack[1].text, /\n※ 同メールで申込あり\n/);
});

test('U5 締切後の送信: 23:59:59 JST 以降は拒否し DB に入らない', async () => {
  const fetch = mockFetch();
  const ctx = makeCtx({ fetch, now: () => Date.parse('2026-09-30T23:59:59+09:00') });
  const r = await handleApply(ctx, sql, sampleInput());
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'closed');
  assert.equal(r.body.error, '申込受付は終了しました');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications`;
  assert.equal(n, 0);
  assert.equal(fetch.calls.gmail.length + fetch.calls.slack.length, 0);

  const later = makeCtx({ fetch, now: () => Date.parse('2026-10-01T10:00:00+09:00') });
  assert.equal((await handleApply(later, sql, sampleInput())).body.code, 'closed');
});

test('U6 締切直前: 締切日 23:59 JST は受け付ける', async () => {
  const ctx = makeCtx({ now: () => Date.parse('2026-09-30T23:59:00+09:00') });
  const r = await handleApply(ctx, sql, sampleInput());
  assert.equal(r.body.ok, true);
  // 23:59:58 も受け付ける
  const r2 = await handleApply(makeCtx({ now: () => Date.parse('2026-09-30T23:59:58+09:00') }), sql, sampleInput());
  assert.equal(r2.body.ok, true);
});

test('U7・U24 未知の eventKey・人数と氏名数の不一致・メール形式不正・必須欠落 は拒否', async () => {
  const ctx = makeCtx();
  const cases = [
    [sampleInput({ eventKey: 'other-event' }), '対象のイベントが見つかりません'],
    [sampleInput({ eventKey: '' }), '対象のイベントが見つかりません'],
    [sampleInput({ attendeeCount: 2 }), '参加人数と参加者氏名の数が一致しません'],
    [sampleInput({ email: 'not-an-email' }), 'メールアドレスの形式が不正です'],
    [sampleInput({ tel: '' }), '必須項目が入力されていません'],
    [sampleInput({ attendeeCount: 0, attendees: [] }), '参加人数が入力されていません'],
    [sampleInput({ carCount: null }), 'お車の台数が入力されていません'],
    [sampleInput({ carCount: 6 }), 'お車の台数は5台までです'],
    [sampleInput({ submission_token: 'not-a-uuid' }), '送信情報が不正です。ページを再読み込みしてお試しください']
  ];
  for (const [input, error] of cases) {
    const r = await handleApply(ctx, sql, input);
    assert.equal(r.status, 400, error);
    assert.equal(r.body.error, error);
  }
  assert.equal((await handleApply(ctx, sql, null)).status, 400);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications`;
  assert.equal(n, 0);
});

test('U8（新 U4）Gmail が応答しない: 保存は成功し mailSent=false・メールは未通知・失敗内容あり', async () => {
  const fetch = mockFetch({ gmail: () => { throw new Error('connect timeout'); } });
  const ctx = makeCtx({ fetch });
  const r = await handleApply(ctx, sql, sampleInput());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mailSent, false);
  const [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.mail_sent_at, null);
  assert.ok(row.slack_sent_at);
  assert.equal(row.notify_attempts, 1);
  assert.match(row.notify_last_error, /メール: Gmail 送信に失敗: connect timeout/);
  // 一時的な失敗では Slack に認証切れの注記を出さない
  assert.doesNotMatch(fetch.calls.slack[0].text, /確認メールを送れていません/);

  // HTTP 500 でも同じ
  const fetch2 = mockFetch({ gmail: () => ({ status: 500, body: { error: { message: 'backend' } } }) });
  const r2 = await handleApply(makeCtx({ fetch: fetch2 }), sql, sampleInput());
  assert.equal(r2.body.mailSent, false);
  const [row2] = await sql`SELECT * FROM applications WHERE id = ${r2.body.id}`;
  assert.match(row2.notify_last_error, /HTTP 500/);
});

test('U9（新 U3）Slack だけ失敗: 運営宛メールに切替・slack_sent_at が入り切替の理由が残る', async () => {
  const fetch = mockFetch({ slack: () => ({ ok: false, error: 'invalid_auth' }) });
  const r = await handleApply(makeCtx({ fetch }), sql, sampleInput());
  assert.equal(r.body.mailSent, true);
  const [row] = await sql`SELECT * FROM applications`;
  assert.ok(row.mail_sent_at);
  assert.ok(row.slack_sent_at);
  assert.match(row.notify_last_error, /Slack: Slack通知に失敗したためメールで通知しています（Slack API error: invalid_auth）/);
  // 申込者へ1通・運営（2名）へ1通。運営宛は community@ を経由せず直接
  assert.equal(fetch.calls.sent.length, 2);
  const op = fetch.calls.sent[1];
  assert.equal(op.to, 'op1@example.com, op2@example.com');
  assert.equal(op.subject, '【申し込み】テスト株式会社 テスト 太郎 様｜関東コミュニティ第4回イベント（ブックオフ出品倉庫 見学会）');
  assert.match(op.body, /^ポータルサイトからイベント参加の申し込みがありました。\n※ Slack通知に失敗/);
  assert.match(op.body, /受付日時：2026\/09\/28 12:00:00/);
  assert.match(op.body, /https:\/\/recore-community-portalsite.vercel.app\/admin$/);
});

test('Slack もフォールバックのメールも失敗: slack_sent_at は空・両方の失敗が残る', async () => {
  let n = 0;
  const fetch = mockFetch({
    slack: () => { throw new Error('ENOTFOUND'); },
    gmail: () => (++n === 1 ? { id: 'ok' } : { status: 503, body: 'unavailable' })
  });
  const r = await handleApply(makeCtx({ fetch }), sql, sampleInput());
  assert.equal(r.body.mailSent, true);
  const [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.slack_sent_at, null);
  assert.match(row.notify_last_error, /Slack 送信に失敗: ENOTFOUND.*さらにメールも失敗（Gmail 送信に失敗（HTTP 503）/);
});

test('（新 U5）メールの認証切れ: 申込は保存・Slack に「確認メールを送れていません」・未通知のまま', async () => {
  const fetch = mockFetch({ oauth: () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }) });
  const r = await handleApply(makeCtx({ fetch }), sql, sampleInput());
  assert.equal(r.status, 200);
  assert.equal(r.body.mailSent, false);
  const [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.mail_sent_at, null);
  assert.ok(row.slack_sent_at);
  assert.match(row.notify_last_error, /メール: Gmail のトークン取得に失敗（HTTP 400 invalid_grant）/);
  assert.equal(fetch.calls.gmail.length, 0);
  assert.match(fetch.calls.slack[0].text, /\n※ 確認メールを送れていません（メール送信の認証が切れています）\n/);
});

test('メールだけ失敗: mail_sent_at は空・slack_sent_at は入る・失敗内容にメール', async () => {
  const fetch = mockFetch({ gmail: () => ({ status: 429, body: { error: { message: 'quota' } } }) });
  const r = await handleApply(makeCtx({ fetch }), sql, sampleInput());
  assert.equal(r.body.mailSent, false);
  const [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.mail_sent_at, null);
  assert.ok(row.slack_sent_at);
  assert.match(row.notify_last_error, /メール: Gmail 送信に失敗（HTTP 429）.*quota/);
});

test('U11 DB 保存が失敗: メール・Slack を送らず 500', async () => {
  const fetch = mockFetch();
  const brokenSql = async () => { throw new Error('connection refused'); };
  const r = await handleApply(makeCtx({ fetch }), brokenSql, sampleInput());
  assert.equal(r.status, 500);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, '送信に失敗しました');
  assert.equal(fetch.calls.gmail.length + fetch.calls.slack.length, 0);
});

test('（新 U7・U12）GAS からの転送は受け付けない: source=gas_forward でも token 無しは 400・保存は source=site', async () => {
  const fetch = mockFetch();
  const ctx = makeCtx({ fetch });
  const input = sampleInput();
  delete input.submission_token;
  const r = await handleApply(ctx, sql, { ...input, source: 'gas_forward', secret: 'anything' });
  assert.equal(r.status, 400);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications`;
  assert.equal(n, 0);
  // token があればふつうの申込として扱い、送信元は site
  const r2 = await handleApply(ctx, sql, { ...sampleInput(), source: 'gas_forward' });
  assert.equal(r2.body.ok, true);
  const [row] = await sql`SELECT source FROM applications`;
  assert.equal(row.source, 'site');
});

test('U23 定員到達: 有効人数が 20 を超えても受け付ける（表示のみ）', async () => {
  const ctx = makeCtx();
  const ten = Array.from({ length: 10 }, (_, i) => 'テスト ' + i);
  await handleApply(ctx, sql, sampleInput({ attendeeCount: 10, attendees: ten }));
  await handleApply(ctx, sql, sampleInput({ attendeeCount: 10, attendees: ten }));
  const r = await handleApply(ctx, sql, sampleInput({ attendeeCount: 2, attendees: ['a', 'b'] }));
  assert.equal(r.body.ok, true);
  const [{ n }] = await sql`SELECT coalesce(sum(cardinality(attendees)),0)::int AS n FROM applications WHERE status='active'`;
  assert.equal(n, 22);
});

test('U26（新 U9）プレビュー（通知の設定なし）: 保存され通知は送らず、試行回数も増えない', async () => {
  const fetch = mockFetch();
  const r = await handleApply(makeCtx({ env: PREVIEW_ENV, fetch }), sql, sampleInput());
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mailSent, false);
  assert.equal(fetch.calls.oauth.length + fetch.calls.gmail.length + fetch.calls.slack.length, 0);
  const [row] = await sql`SELECT * FROM applications`;
  assert.equal(row.mail_sent_at, null);
  assert.equal(row.notify_attempts, 0);
  // 一部だけ設定があっても送らない（Slack だけ・Gmail だけ）
  for (const env of [{ ...PREVIEW_ENV, SLACK_BOT_TOKEN: 'x', SLACK_CHANNEL_ID: 'C' }, { ...PREVIEW_ENV, GMAIL_CLIENT_ID: 'a', GMAIL_CLIENT_SECRET: 'b', GMAIL_REFRESH_TOKEN: 'c', MAIL_FROM: 'd@example.com' }]) {
    await handleApply(makeCtx({ env, fetch }), sql, sampleInput());
  }
  assert.equal(fetch.calls.oauth.length + fetch.calls.gmail.length + fetch.calls.slack.length, 0);
});
