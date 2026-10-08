// 管理 API（U14〜U19・U22・U23、運営登録と区分 U27〜U34）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql, resetDb, makeCtx, mockFetch, sampleInput, tokenInfo, TEST_ENV } from './helpers.mjs';
import { handleApply } from '../api/_lib/apply-core.js';
import { handleAdmin } from '../api/_lib/admin-core.js';
import { runCron } from '../api/_lib/cron-core.js';

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
  assert.deepEqual(kanto.summary, { companies: 2, attendees: 4, cars: 1, capacity: 20, remaining: 16, pending: 0, byCategory: { general: 4, recore: 0, vendor: 0, staff: 0 } });
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
  assert.deepEqual(r.body.summary, { companies: 1, attendees: 1, cars: 0, capacity: 20, remaining: 19, pending: 0, byCategory: { general: 1, recore: 0, vendor: 0, staff: 0 } });
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

// ---- 運営登録と区分（attendee-category）----

function registerInput(overrides = {}) {
  return {
    action: 'register',
    idToken: VIEWER,
    submission_token: crypto.randomUUID(),
    eventKey: 'kanto-vol4',
    category: 'recore',
    company: '',
    attendees: ['社内 一郎', '社内 二郎'],
    carCount: 0,
    message: '社内参加',
    ...overrides
  };
}

test('U27 閲覧者（清野さん以外）が RECORE を2名登録: 行・履歴 create・集計・Slack【運営登録】', async () => {
  const { ctx, fetch } = adminCtx();
  await seed(ctx);
  const before = (await handleAdmin(ctx, sql, { action: 'list', idToken: VIEWER })).body;
  assert.equal(before.canRegister, true);
  const s0 = before.events[0].summary;
  const slackBefore = fetch.calls.slack.length;
  const sentBefore = fetch.calls.gmail.length;

  const input = registerInput();
  const r = await handleAdmin(ctx, sql, input);
  assert.equal(r.status, 200);
  assert.equal(r.body.notified, true);
  const app = r.body.application;
  assert.equal(app.category, 'recore');
  assert.equal(app.company, '株式会社RECORE');
  assert.equal(app.representative_name, '社内 一郎');
  assert.deepEqual([app.role, app.email, app.tel], ['', '', '']);
  assert.equal(app.source, 'admin');
  assert.equal(app.event_name, '関東コミュニティ第4回イベント（ブックオフ出品倉庫 見学会）');

  // 人数 +2・残り枠 -2・社数は変わらない
  assert.equal(r.body.summary.attendees, s0.attendees + 2);
  assert.equal(r.body.summary.remaining, s0.remaining - 2);
  assert.equal(r.body.summary.companies, s0.companies);
  assert.deepEqual(r.body.summary.byCategory, { general: 4, recore: 2, vendor: 0, staff: 0 });

  const hist = await sql`SELECT * FROM application_changes WHERE application_id = ${app.id}`;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].action, 'create');
  assert.equal(hist[0].changed_by, 'viewer@example.com');
  assert.equal(hist[0].before, null);
  assert.deepEqual(hist[0].after, { category: 'recore', company: '株式会社RECORE', attendees: ['社内 一郎', '社内 二郎'], car_count: 0, message: '社内参加' });

  const notify = fetch.calls.slack.slice(slackBefore);
  assert.equal(notify.length, 1);
  assert.equal(notify[0].text, [
    '*【運営登録】* 関東コミュニティ第4回イベント（ブックオフ出品倉庫 見学会）',
    '',
    '*区分：* RECORE',
    '*会社名：* 株式会社RECORE',
    '*参加人数：* 2名（社内 一郎、社内 二郎）',
    '*お車の台数：* 0台（公共交通機関）',
    '*メモ：* 社内参加',
    '*登録者：* viewer@example.com',
    '',
    '<https://recore-community-portalsite.vercel.app/admin|申し込み一覧を開く>'
  ].join('\n'));
  // 申込者へのメールは送らない（U32）
  assert.equal(fetch.calls.gmail.length, sentBefore);

  // 同じトークンの再送（連打）は保存しない
  const again = await handleAdmin(ctx, sql, input);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications WHERE source = 'admin'`;
  assert.equal(n, 1);
  assert.equal(fetch.calls.slack.length, slackBefore + 1);

  // ベンダー・運営は会社名をそのまま持つ
  const v = await handleAdmin(ctx, sql, registerInput({ category: 'vendor', company: 'ベンダー株式会社', attendees: ['外部 太郎'], carCount: 1 }));
  assert.equal(v.status, 200);
  assert.equal(v.body.application.company, 'ベンダー株式会社');
  assert.deepEqual(v.body.summary.byCategory, { general: 4, recore: 2, vendor: 1, staff: 0 });
  assert.equal(v.body.summary.cars, s0.cars + 1);
});

test('U28 締切後に登録できる。フォームからの申込は締切で止まる', async () => {
  // 関東 Vol.4 の締切（9/30）を過ぎた 10/5。トークンの期限もその時刻に合わせる
  const now = () => Date.parse('2026-10-05T18:00:00+09:00');
  const exp = String(Math.floor(Date.parse('2026-10-05T19:00:00+09:00') / 1000));
  const lateCtx = makeCtx({ fetch: mockFetch({ tokens: { [VIEWER]: tokenInfo('viewer@example.com', { exp }) } }), now });
  const r = await handleAdmin(lateCtx, sql, registerInput());
  assert.equal(r.status, 200);
  const f = await handleApply(lateCtx, sql, sampleInput());
  assert.equal(f.status, 400);
  assert.equal(f.body.code, 'closed');
});

test('U29 不正な入力（氏名0名・台数6・未知の区分・会社名空・未知のイベント・トークン無し）は 400 で保存しない', async () => {
  const { ctx, fetch } = adminCtx();
  const cases = [
    registerInput({ attendees: [] }),
    registerInput({ attendees: ['  ', ''] }),
    registerInput({ carCount: 6 }),
    registerInput({ carCount: '' }),
    registerInput({ category: 'guest' }),
    registerInput({ category: '' }),
    registerInput({ category: 'vendor', company: '' }),
    registerInput({ category: 'staff', company: '   ' }),
    registerInput({ eventKey: 'unknown-event' }),
    registerInput({ submission_token: undefined })
  ];
  for (const c of cases) {
    const r = await handleAdmin(ctx, sql, c);
    assert.equal(r.status, 400, JSON.stringify(c));
    assert.ok(r.body.error);
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications`;
  const [{ h }] = await sql`SELECT count(*)::int AS h FROM application_changes`;
  assert.equal(n, 0);
  assert.equal(h, 0);
  assert.equal(fetch.calls.slack.length, 0);
});

test('U30 許可リスト外・不正トークンで register は 403', async () => {
  const { ctx, fetch } = adminCtx();
  for (const idToken of ['outsider', 'other-aud', 'expired', 'unknown-token', undefined]) {
    const r = await handleAdmin(ctx, sql, registerInput({ idToken }));
    assert.equal(r.status, 403, String(idToken));
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications`;
  assert.equal(n, 0);
  assert.equal(fetch.calls.slack.length, 0);
});

test('U31 区分の変更: 清野さんはできて履歴と【申込変更】に区分、閲覧のみの運営は 403', async () => {
  const { ctx, fetch } = adminCtx();
  const ids = await seed(ctx);
  const denied = await handleAdmin(ctx, sql, { action: 'update', idToken: VIEWER, id: ids.a, category: 'recore' });
  assert.equal(denied.status, 403);
  assert.equal((await sql`SELECT category FROM applications WHERE id = ${ids.a}`)[0].category, 'general');

  const slackBefore = fetch.calls.slack.length;
  const r = await handleAdmin(ctx, sql, { action: 'update', idToken: EDITOR, id: ids.a, category: 'recore' });
  assert.equal(r.status, 200);
  assert.equal(r.body.application.category, 'recore');
  assert.equal(r.body.summary.companies, 1);
  assert.deepEqual(r.body.summary.byCategory, { general: 1, recore: 3, vendor: 0, staff: 0 });
  const [hist] = await sql`SELECT * FROM application_changes WHERE application_id = ${ids.a}`;
  assert.deepEqual(hist.before, { category: 'general' });
  assert.deepEqual(hist.after, { category: 'recore' });
  const text = fetch.calls.slack.slice(slackBefore)[0].text;
  assert.match(text, /\n\*区分：\* 一般参加者 → RECORE\n/);

  // 未知の区分は 400
  assert.equal((await handleAdmin(ctx, sql, { action: 'update', idToken: EDITOR, id: ids.a, category: 'guest' })).status, 400);
});

test('U32 運営登録の行: メールを送らない・通知未完了に数えない・Cron が拾わない・再送は拒否', async () => {
  const { ctx, fetch } = adminCtx();
  const r = await handleAdmin(ctx, sql, registerInput());
  const id = r.body.application.id;
  assert.equal(fetch.calls.gmail.length, 0);
  assert.equal(r.body.summary.pending, 0);
  const list = await handleAdmin(ctx, sql, { action: 'list', idToken: EDITOR });
  assert.equal(list.body.events[0].summary.pending, 0);
  const cron = await runCron(ctx, sql);
  assert.equal(cron.processed, 0);
  const s = await handleAdmin(ctx, sql, { action: 'resend', idToken: EDITOR, id });
  assert.equal(s.status, 400);
  assert.equal(fetch.calls.gmail.length, 0);
  assert.equal(fetch.calls.slack.length, 1);
  // 清野さんは運営登録の行も取消できる（D23）
  const c = await handleAdmin(ctx, sql, { action: 'cancel', idToken: EDITOR, id });
  assert.equal(c.status, 200);
  assert.equal(c.body.summary.attendees, 0);
});

test('U33 Slack もメールも失敗しても登録は成立し、notified=false を返す', async () => {
  const { ctx } = adminCtx({ slack: () => ({ ok: false, error: 'channel_not_found' }), gmail: () => { throw new Error('down'); } });
  const r = await handleAdmin(ctx, sql, registerInput());
  assert.equal(r.status, 200);
  assert.equal(r.body.notified, false);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM applications WHERE source = 'admin'`;
  assert.equal(n, 1);
  // Slack だけ失敗し運営宛メールで届いたときは通知できた扱い（取消・変更と同じ）
  const { ctx: ctx2, fetch: f2 } = adminCtx({ slack: () => ({ ok: false, error: 'channel_not_found' }) });
  const r2 = await handleAdmin(ctx2, sql, registerInput());
  assert.equal(r2.body.notified, true);
  assert.equal(f2.calls.sent.length, 1);
  assert.match(f2.calls.sent[0].subject, /^【運営登録】株式会社RECORE 社内 一郎 様｜関東コミュニティ第4回イベント/);
});
