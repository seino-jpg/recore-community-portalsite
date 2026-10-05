// 管理 API（U14〜U19・U22・U23）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql, resetDb, makeCtx, mockFetch, sampleInput, tokenInfo, TEST_ENV } from './helpers.mjs';
import { handleApply } from '../api/_lib/apply-core.js';
import { handleAdmin } from '../api/_lib/admin-core.js';

const EDITOR = 'editor-token';
const VIEWER = 'viewer-token';

function adminCtx(overrides = {}) {
  const fetch = mockFetch({
    tokens: {
      [EDITOR]: tokenInfo('editor@example.com'),
      [VIEWER]: tokenInfo('viewer@example.com'),
      'other-aud': tokenInfo('editor@example.com', { aud: 'another-site.apps.googleusercontent.com' }),
      'expired': tokenInfo('editor@example.com', { exp: String(Math.floor(Date.parse('2026-09-28T11:00:00+09:00') / 1000)) }),
      'unverified': tokenInfo('editor@example.com', { email_verified: 'false' }),
      'outsider': tokenInfo('outsider@example.com'),
      'bad-iss': tokenInfo('editor@example.com', { iss: 'https://evil.example' })
    },
    ...overrides
  });
  return { ctx: makeCtx({ fetch }), fetch };
}

async function seed(ctx) {
  const a = await handleApply(ctx, sql, sampleInput());
  const b = await handleApply(ctx, sql, sampleInput({ company: 'テスト商事', email: 'test2@example.com', attendeeCount: 1, attendees: ['テスト 二郎'], carCount: 0, tel: '+819000000000' }));
  return { a: a.body.id, b: b.body.id };
}

beforeEach(resetDb);

test('U14 閲覧: 許可リストのアカウントに一覧と集計（有効行のみ）', async () => {
  const { ctx } = adminCtx();
  const ids = await seed(ctx);
  const r = await handleAdmin(ctx, sql, { action: 'list', idToken: VIEWER });
  assert.equal(r.status, 200);
  assert.equal(r.body.viewer, 'viewer@example.com');
  assert.equal(r.body.canEdit, false);
  assert.deepEqual(r.body.events.map((e) => e.key), ['kanto-vol4', 'kansai-vol2']);
  const kanto = r.body.events[0];
  assert.equal(kanto.rows.length, 2);
  assert.deepEqual(kanto.summary, { companies: 2, attendees: 4, cars: 1, capacity: 20, remaining: 16, pending: 0 });
  // U2: 電話原文・U22: 関西は0件
  assert.equal(kanto.rows.find((x) => x.id === ids.b).tel, '+819000000000');
  assert.equal(kanto.rows.find((x) => x.id === ids.a).attendee_count, 3);
  assert.equal(r.body.events[1].rows.length, 0);
  assert.equal(r.body.events[1].summary.capacity, null);
  assert.equal(r.body.events[1].summary.remaining, null);
});

test('U15 不正トークン: 別 aud・期限切れ・未検証・許可外・発行元不正・無効 は 403 でデータを返さない', async () => {
  const { ctx } = adminCtx();
  await seed(ctx);
  for (const idToken of ['other-aud', 'expired', 'unverified', 'outsider', 'bad-iss', 'unknown-token', '', undefined]) {
    const r = await handleAdmin(ctx, sql, { action: 'list', idToken });
    assert.equal(r.status, 403, String(idToken));
    assert.equal(r.body.events, undefined);
  }
  // 設定漏れは全員拒否
  const noConf = makeCtx({ env: { ...TEST_ENV, ADMIN_EMAILS: '' }, fetch: adminCtx().fetch });
  assert.equal((await handleAdmin(noConf, sql, { action: 'list', idToken: EDITOR })).status, 403);
});

test('U16 取消: status=cancelled・取消日時と操作者・履歴1件・Slack 通知・残り枠が増える', async () => {
  const { ctx, fetch } = adminCtx();
  const ids = await seed(ctx);
  const slackBefore = fetch.calls.slack.length;
  const r = await handleAdmin(ctx, sql, { action: 'cancel', idToken: EDITOR, id: ids.a });
  assert.equal(r.status, 200);
  assert.equal(r.body.application.status, 'cancelled');
  assert.equal(r.body.application.cancelled_by, 'editor@example.com');
  assert.ok(r.body.application.cancelled_at);
  assert.deepEqual(r.body.summary, { companies: 1, attendees: 1, cars: 0, capacity: 20, remaining: 19, pending: 0 });
  assert.equal(r.body.notified, true);

  const hist = await sql`SELECT * FROM application_changes WHERE application_id = ${ids.a}`;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].action, 'cancel');
  assert.equal(hist[0].changed_by, 'editor@example.com');
  assert.deepEqual(hist[0].before, { status: 'active' });
  assert.equal(hist[0].after.status, 'cancelled');

  // 運営 Slack にだけ通知（申込者へのメールは送らない）
  const notify = fetch.calls.slack.slice(slackBefore);
  assert.equal(notify.length, 1);
  assert.equal(notify[0].text, [
    '*【申込取消】* 関東コミュニティ第4回イベント（ブックオフ出品倉庫 見学会）',
    '',
    '*会社名：* テスト株式会社',
    '*代表者：* テスト 太郎（経営者）',
    '*メールアドレス：* test@example.com',
    '*電話番号：* 090-0000-0000',
    '*参加人数：* 3名（テスト 太郎、テスト 花子、テスト 次郎）',
    '*お車の台数：* 1台',
    '*操作者：* editor@example.com',
    '',
    '<https://recore-community-portalsite.vercel.app/admin|申し込み一覧を開く>'
  ].join('\n'));
  assert.equal(fetch.calls.sent.length, 2);   // seed の申込者2通だけ

  // 一覧では取消行が残り、集計から外れる
  const list = await handleAdmin(ctx, sql, { action: 'list', idToken: VIEWER });
  const kanto = list.body.events[0];
  assert.equal(kanto.rows.length, 2);
  assert.equal(kanto.rows.find((x) => x.id === ids.a).status, 'cancelled');
  assert.equal(kanto.summary.companies, 1);
});

test('U17 人数変更: 同行者を1名追加 → attendees 4要素・履歴に before/after・Slack 通知', async () => {
  const { ctx, fetch } = adminCtx();
  const ids = await seed(ctx);
  const slackBefore = fetch.calls.slack.length;
  const r = await handleAdmin(ctx, sql, {
    action: 'update', idToken: EDITOR, id: ids.a,
    attendees: ['テスト 太郎', 'テスト 花子', 'テスト 次郎', 'テスト 三郎'], carCount: 1, message: ''
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.application.attendee_count, 4);
  assert.equal(r.body.summary.attendees, 5);

  const [hist] = await sql`SELECT * FROM application_changes WHERE application_id = ${ids.a}`;
  assert.equal(hist.action, 'update');
  assert.deepEqual(hist.before, { attendees: ['テスト 太郎', 'テスト 花子', 'テスト 次郎'] });
  assert.deepEqual(hist.after, { attendees: ['テスト 太郎', 'テスト 花子', 'テスト 次郎', 'テスト 三郎'] });

  const notify = fetch.calls.slack.slice(slackBefore);
  assert.equal(notify.length, 1);
  assert.match(notify[0].text, /^\*【申込変更】\* /);
  assert.match(notify[0].text, /\n\*参加者：\* 3名（テスト 太郎、テスト 花子、テスト 次郎） → 4名（テスト 太郎、テスト 花子、テスト 次郎、テスト 三郎）\n/);
  assert.doesNotMatch(notify[0].text, /お車の台数/);

  // 台数・要望だけの変更も履歴は変えた項目だけ
  const r2 = await handleAdmin(ctx, sql, { action: 'update', idToken: EDITOR, id: ids.a, carCount: 2, message: '駐車場希望' });
  assert.equal(r2.status, 200);
  const h2 = await sql`SELECT * FROM application_changes WHERE application_id = ${ids.a} ORDER BY changed_at`;
  assert.deepEqual(h2[1].before, { car_count: 1, message: '' });
  assert.deepEqual(h2[1].after, { car_count: 2, message: '駐車場希望' });
  const n2 = fetch.calls.slack.at(-1).text;
  assert.match(n2, /\*お車の台数：\* 1台 → 2台\n\*ご質問・ご要望：\* なし → 駐車場希望\n/);

  // 変更なし・不正値は 400
  assert.equal((await handleAdmin(ctx, sql, { action: 'update', idToken: EDITOR, id: ids.a, carCount: 2 })).status, 400);
  assert.equal((await handleAdmin(ctx, sql, { action: 'update', idToken: EDITOR, id: ids.a, attendees: [] })).status, 400);
  assert.equal((await handleAdmin(ctx, sql, { action: 'update', idToken: EDITOR, id: ids.a, carCount: 9 })).status, 400);
});

test('U18 取消行の変更・再取消・再送は拒否', async () => {
  const { ctx } = adminCtx();
  const ids = await seed(ctx);
  await handleAdmin(ctx, sql, { action: 'cancel', idToken: EDITOR, id: ids.a });
  const u = await handleAdmin(ctx, sql, { action: 'update', idToken: EDITOR, id: ids.a, carCount: 3 });
  assert.equal(u.status, 409);
  const c = await handleAdmin(ctx, sql, { action: 'cancel', idToken: EDITOR, id: ids.a });
  assert.equal(c.status, 409);
  const s = await handleAdmin(ctx, sql, { action: 'resend', idToken: EDITOR, id: ids.a });
  assert.equal(s.status, 409);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM application_changes WHERE application_id = ${ids.a}`;
  assert.equal(n, 1);
});

test('U18b 清野さん以外の取消・変更・再送: 閲覧のみの運営は 403、DB も履歴も変わらない', async () => {
  const { ctx, fetch } = adminCtx();
  const ids = await seed(ctx);
  const slackBefore = fetch.calls.slack.length;
  const list = await handleAdmin(ctx, sql, { action: 'list', idToken: VIEWER });
  assert.equal(list.body.canEdit, false);
  for (const action of ['cancel', 'update', 'resend']) {
    const r = await handleAdmin(ctx, sql, { action, idToken: VIEWER, id: ids.a, carCount: 3 });
    assert.equal(r.status, 403, action);
  }
  const [row] = await sql`SELECT * FROM applications WHERE id = ${ids.a}`;
  assert.equal(row.status, 'active');
  assert.equal(row.car_count, 1);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM application_changes`;
  assert.equal(n, 0);
  assert.equal(fetch.calls.slack.length, slackBefore);
  // 編集者は canEdit=true
  assert.equal((await handleAdmin(ctx, sql, { action: 'list', idToken: EDITOR })).body.canEdit, true);
});

test('U19 連絡先の変更: API はメール・電話・会社名を受け付けない（無視して変更なし扱い）', async () => {
  const { ctx } = adminCtx();
  const ids = await seed(ctx);
  const r = await handleAdmin(ctx, sql, { action: 'update', idToken: EDITOR, id: ids.a, email: 'new@example.com', tel: '000', company: '別社' });
  assert.equal(r.status, 400);
  const [row] = await sql`SELECT * FROM applications WHERE id = ${ids.a}`;
  assert.equal(row.email, 'test@example.com');
  assert.equal(row.tel, '090-0000-0000');
});

test('U10 再送ボタン: 未通知の行を手動で再送し履歴に notify、通知未完了件数が減る', async () => {
  let down = true;
  const fail = (ok) => () => { if (down) throw new Error('down'); return ok; };
  const { ctx, fetch } = adminCtx({ gmail: fail({ id: 'm' }), slack: fail({ ok: true }) });
  const a = await handleApply(ctx, sql, sampleInput());
  assert.equal(a.body.mailSent, false);
  let list = await handleAdmin(ctx, sql, { action: 'list', idToken: EDITOR });
  assert.equal(list.body.events[0].summary.pending, 1);

  down = false;
  const r = await handleAdmin(ctx, sql, { action: 'resend', idToken: EDITOR, id: a.body.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.mailSent, true);
  assert.equal(r.body.slackSent, true);
  assert.equal(r.body.summary.pending, 0);
  const [hist] = await sql`SELECT * FROM application_changes WHERE application_id = ${a.body.id}`;
  assert.equal(hist.action, 'notify');
  assert.equal(hist.changed_by, 'editor@example.com');
  // 送信済みの行の再送は 400
  assert.equal((await handleAdmin(ctx, sql, { action: 'resend', idToken: EDITOR, id: a.body.id })).status, 400);
  assert.equal(fetch.calls.sent.length, 1);
  assert.equal(fetch.calls.slack.length, 2);
});

test('U23 残り枠がマイナス表示になる', async () => {
  const { ctx } = adminCtx();
  const ten = Array.from({ length: 10 }, (_, i) => 'テスト ' + i);
  await handleApply(ctx, sql, sampleInput({ attendeeCount: 10, attendees: ten }));
  await handleApply(ctx, sql, sampleInput({ attendeeCount: 10, attendees: ten }));
  await handleApply(ctx, sql, sampleInput({ attendeeCount: 2, attendees: ['a', 'b'] }));
  const r = await handleAdmin(ctx, sql, { action: 'list', idToken: VIEWER });
  assert.equal(r.body.events[0].summary.remaining, -2);
});

test('D19 プレビュー（許可リスト・クライアント ID なし）: 管理 API は 403', async () => {
  const { fetch } = adminCtx();
  const env = { ...TEST_ENV, GOOGLE_CLIENT_ID: '', ADMIN_EMAILS: '', ADMIN_EDITOR_EMAILS: '' };
  const r = await handleAdmin(makeCtx({ env, fetch }), sql, { action: 'list', idToken: EDITOR });
  assert.equal(r.status, 403);
});
