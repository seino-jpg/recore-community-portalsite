// 通知の文面・MIME・Gmail の認証（GAS 廃止の設計 U1・U3・U5・U6・U10）。DB を使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, mockFetch, decodeMime, TEST_ENV } from './helpers.mjs';
import { sendApplicationNotify, sendChangeNotify } from '../api/_lib/notifier.js';
import { buildMime } from '../api/_lib/gmail.js';

const EVENT = {
  name: '関東コミュニティ第4回イベント（ブックオフ出品倉庫 見学会）',
  date_text: '2026年10月22日（木）12:00〜16:00（受付 11:30〜12:00）',
  place: '東名横浜ロジスティクスセンター（神奈川県横浜市瀬谷区北町25-9）',
  detail: '見学A\n見学B'
};

function app(overrides = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    event_name: EVENT.name,
    company: 'テスト株式会社',
    representative_name: 'テスト 太郎',
    role: '',
    email: 'test@example.com',
    tel: '+819000000000',
    attendees: ['テスト 太郎', 'テスト 花子'],
    car_count: 0,
    message: '',
    received_at: '2026-09-28T03:00:00.000Z',
    ...overrides
  };
}

test('（新 U1）確認メールの全文は GAS の文面と同じ（署名のアドレスだけ送信元）', async () => {
  const fetch = mockFetch();
  const r = await sendApplicationNotify(makeCtx({ fetch }), { application: app(), event: EVENT, send: { mail: true, slack: true }, duplicateEmail: false });
  assert.equal(r.sent, true);
  assert.equal(r.mail.ok, true);
  assert.equal(r.slack.ok, true);
  const m = fetch.calls.sent[0];
  assert.equal(m.body, [
    'テスト株式会社',
    'テスト 太郎 様',
    '',
    'この度は RECOREコミュニティイベントへお申し込みいただき、ありがとうございます。',
    '以下の内容で受け付けました。',
    '',
    '────────────────────────',
    '【イベント】',
    EVENT.name,
    '',
    '【開催日時】',
    EVENT.date_text,
    '',
    '【開催場所】',
    EVENT.place,
    '',
    '【内容】',
    '見学A',
    '見学B',
    '────────────────────────',
    '',
    '【お申し込み内容】',
    '会社名：テスト株式会社',
    '代表者：テスト 太郎',
    '役職：未回答',
    'メールアドレス：test@example.com',
    '電話番号：+819000000000',
    '参加人数：2名',
    '参加者：テスト 太郎、テスト 花子',
    'お車の台数：0台（公共交通機関）',
    '',
    'ご不明な点がございましたら、本メールにご返信ください。',
    '',
    '────────────────────────',
    'RECOREコミュニティ事務局',
    'community@example.com',
    'https://recore-community-portalsite.vercel.app/'
  ].join('\n'));
  assert.equal(fetch.calls.slack[0].text, [
    '*【イベント申し込み】* ' + EVENT.name,
    '',
    '*会社名：* テスト株式会社',
    '*代表者：* テスト 太郎（役職未回答）',
    '*メールアドレス：* test@example.com',
    '*電話番号：* +819000000000',
    '*参加人数：* 2名（テスト 太郎、テスト 花子）',
    '*お車の台数：* 0台（公共交通機関）',
    '*ご質問・ご要望：* なし',
    '*受付日時：* 2026/09/28 12:00',
    '',
    '<https://recore-community-portalsite.vercel.app/admin|申し込み一覧を開く>'
  ].join('\n'));
  assert.equal(fetch.calls.slack[0].unfurl_links, false);
});

test('（新 U10）全角記号・機種依存文字・絵文字・長い会社名でも件名・本文・差出人名が化けない', async () => {
  const company = '株式会社㈱①ⅢＲＥＣＯＲＥ～－“テスト”🍣🚚' + 'あ'.repeat(80);
  const fetch = mockFetch({ slack: () => ({ ok: false, error: 'x' }) });   // 運営宛メール（件名に会社名が入る）も作らせる
  await sendApplicationNotify(makeCtx({ fetch }), {
    application: app({ company, representative_name: '髙橋 𠮷子', message: '駐車場は2台分🙏\n2行目' }),
    event: EVENT, send: { mail: true, slack: true }, duplicateEmail: false
  });
  const [toApplicant, toOperators] = fetch.calls.sent;
  assert.match(toApplicant.body, new RegExp('^' + company + '\n髙橋 𠮷子 様\n'));
  assert.match(toApplicant.body, /ご質問・ご要望：駐車場は2台分🙏\n2行目\n/);
  assert.equal(toApplicant.from, 'RECOREコミュニティ事務局 <community@example.com>');
  assert.equal(toOperators.subject, '【申し込み】' + company + ' 髙橋 𠮷子 様｜' + EVENT.name);
  // encoded-word は1語75文字以内・ヘッダー1行は折り返して 998 文字未満
  for (const w of toOperators.headerText.match(/=\?UTF-8\?B\?[^?]*\?=/g)) assert.ok(w.length <= 75, w);
  const raw = Buffer.from(buildMime({ from: 'a@example.com', to: 'b@example.com', subject: toOperators.subject, body: 'x' }), 'base64url').toString('utf8');
  for (const line of raw.split('\r\n')) assert.ok(line.length < 998);
});

test('ヘッダーに改行を入れさせない（件名・宛先の改行は空白にする）', () => {
  const mail = decodeMime(buildMime({ from: 'a@example.com', to: 'b@example.com\r\nBcc: evil@example.com', subject: '件名\r\nBcc: evil@example.com', body: 'x' }));
  assert.equal(mail.headers.bcc, undefined);
  assert.equal(mail.to, 'b@example.com Bcc: evil@example.com');
  assert.equal(mail.subject, '件名 Bcc: evil@example.com');
});

test('アクセストークンは使い回し、期限の1分前に取り直す', async () => {
  const fetch = mockFetch();
  let t = Date.parse('2026-09-28T12:00:00+09:00');
  const ctx = makeCtx({ fetch, now: () => t });
  const args = { application: app(), event: EVENT, send: { mail: true, slack: false }, duplicateEmail: false };
  await sendApplicationNotify(ctx, args);
  await sendApplicationNotify(ctx, args);
  assert.equal(fetch.calls.oauth.length, 1);
  assert.deepEqual(fetch.calls.oauth[0], {
    client_id: TEST_ENV.GMAIL_CLIENT_ID, client_secret: TEST_ENV.GMAIL_CLIENT_SECRET,
    refresh_token: TEST_ENV.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token'
  });
  t += 3599 * 1000 - 59 * 1000;   // 期限まで59秒
  await sendApplicationNotify(ctx, args);
  assert.equal(fetch.calls.oauth.length, 2);
});

test('Gmail が 401 を返したら認証切れとして扱い、次は取り直す', async () => {
  let n = 0;
  const fetch = mockFetch({ gmail: () => (++n === 1 ? { status: 401, body: {} } : { id: 'ok' }) });
  const ctx = makeCtx({ fetch });
  const args = { application: app(), event: EVENT, send: { mail: true, slack: true }, duplicateEmail: false };
  const r1 = await sendApplicationNotify(ctx, args);
  assert.equal(r1.mail.ok, false);
  assert.equal(r1.mail.authError, true);
  assert.match(fetch.calls.slack[0].text, /※ 確認メールを送れていません/);
  const r2 = await sendApplicationNotify(ctx, { ...args, send: { mail: true, slack: false } });
  assert.equal(r2.mail.ok, true);
  assert.equal(fetch.calls.oauth.length, 2);
});

test('（新 U6）変更通知は Slack だけ。Slack が失敗したら運営宛メール（件名・本文は GAS と同じ）', async () => {
  const fetch = mockFetch({ slack: () => ({ ok: false, error: 'channel_not_found' }) });
  const r = await sendChangeNotify(makeCtx({ fetch }), {
    type: 'cancel', application: app(), event: EVENT, changedBy: 'editor@example.com', before: { status: 'active' }, after: { status: 'cancelled' }
  });
  assert.deepEqual(r.slack, { ok: true, fallback: 'mail', error: 'Slack通知に失敗したためメールで通知しています（Slack API error: channel_not_found）。' });
  assert.equal(fetch.calls.sent.length, 1);
  const m = fetch.calls.sent[0];
  assert.equal(m.to, TEST_ENV.OPERATOR_EMAILS);
  assert.equal(m.subject, '【申込取消】テスト株式会社 テスト 太郎 様｜' + EVENT.name);
  assert.equal(m.body, '※ ' + r.slack.error + '\n\n' + fetch.calls.slack[0].text);
  // 不明な type は送らない
  const bad = await sendChangeNotify(makeCtx({ fetch }), { type: 'delete', application: app(), event: EVENT });
  assert.equal(bad.sent, false);
});
