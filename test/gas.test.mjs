// GAS（送信専用）のコードを Node の vm でモックと一緒に動かす（U9・U12・U13・U25・D10・D15）
// GAS のソースは GAS_DIR（既定 ~/gas-community-form）。無ければスキップ。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const GAS_DIR = process.env.GAS_DIR || path.join(homedir(), 'gas-community-form');
const FILES = ['Code.js', 'Mail.js', 'Slack.js', 'Admin.js'];
const available = existsSync(path.join(GAS_DIR, 'Code.js'));

const SECRET = 'test-shared-secret';

function makeGas({ props = {}, slack = () => ({ ok: true }), site = () => ({ ok: true, id: 'x', mailSent: true }), mail = () => {} } = {}) {
  const calls = { mail: [], slack: [], site: [], sheet: 0 };
  const sandbox = {
    console: { log() {}, error() {} },
    MailApp: { sendEmail(opts) { calls.mail.push(opts); mail(opts); } },
    UrlFetchApp: {
      fetch(url, opts) {
        if (url.startsWith('https://slack.com/')) {
          calls.slack.push(JSON.parse(opts.payload));
          const body = slack(JSON.parse(opts.payload));
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
        }
        if (url === props.SITE_API_URL) {
          const payload = JSON.parse(opts.payload);
          calls.site.push(payload);
          const r = site(payload);
          return { getResponseCode: () => r.status || 200, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body || r)) };
        }
        throw new Error('unexpected UrlFetchApp.fetch: ' + url);
      }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType() { return { getContent: () => s }; } })
    },
    // シートに触れたら失敗させる（書かない・読まないことの証明）
    SpreadsheetApp: new Proxy({}, { get() { calls.sheet++; throw new Error('SpreadsheetApp must not be used'); } }),
    Utilities: { formatDate() { throw new Error('Utilities.formatDate must not be used'); } }
  };
  vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(readFileSync(path.join(GAS_DIR, f), 'utf8'), sandbox, { filename: f });
  const post = (obj) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent());
  return { post, calls, notifyTo: sandbox.NOTIFY_TO };
}

const PROPS = { SITE_SHARED_SECRET: SECRET, SITE_API_URL: 'https://site.example.test/api/apply', SLACK_BOT_TOKEN: 'xoxb-test' };

const application = {
  id: '00000000-0000-4000-8000-000000000001',
  company: 'テスト株式会社', representative_name: 'テスト 太郎', role: '経営者',
  email: 'test@example.com', tel: '+819000000000',
  attendees: ['テスト 太郎', 'テスト 花子', 'テスト 次郎'], car_count: 1, message: '',
  event_name: '関東コミュニティ第4回イベント（ブックオフ出品倉庫 見学会）',
  received_at_jst: '2026/09/28 12:00:00', received_at_jst_short: '2026/09/28 12:00'
};
const event = { name: '関東コミュニティ第4回イベント（ブックオフ出品倉庫 見学会）', date_text: '2026年10月22日（木）12:00〜16:00', place: '会場A', detail: '見学\n交流' };

test('GAS: 申込通知 — 秘密付きの要求でメールと Slack を送り、文面に原文の電話番号と /admin リンク', { skip: !available }, () => {
  const g = makeGas({ props: PROPS });
  const r = g.post({ action: 'notify_application', secret: SECRET, application, event, send: { mail: true, slack: true }, notes: [] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.mail, { ok: true });
  assert.deepEqual(r.slack, { ok: true });
  assert.equal(g.calls.mail.length, 1);
  const m = g.calls.mail[0];
  assert.equal(m.to, 'test@example.com');
  assert.equal(m.subject, '【RECOREコミュニティ】お申し込みを受け付けました');
  assert.equal(m.name, 'RECOREコミュニティ事務局');
  assert.match(m.body, /電話番号：\+819000000000/);
  assert.match(m.body, /参加人数：3名/);
  assert.match(m.body, /【開催場所】\n会場A/);
  assert.equal(g.calls.slack.length, 1);
  const s = g.calls.slack[0];
  assert.equal(s.channel, 'C08PTUBAWGZ');
  assert.match(s.text, /\*電話番号：\* \+819000000000/);
  assert.match(s.text, /\*受付日時：\* 2026\/09\/28 12:00/);
  assert.match(s.text, /<https:\/\/recore-community-portalsite\.vercel\.app\/admin\|申し込み一覧を開く>/);
  assert.doesNotMatch(s.text, /docs\.google\.com/);
  assert.equal(g.calls.sheet, 0);
});

test('GAS U4: notes があれば Slack に「同メールで申込あり」注記', { skip: !available }, () => {
  const g = makeGas({ props: PROPS });
  g.post({ action: 'notify_application', secret: SECRET, application, event, send: { mail: true, slack: true }, notes: ['同メールで申込あり'] });
  assert.match(g.calls.slack[0].text, /※ 同メールで申込あり/);
});

test('GAS: send で頼まれた分だけ送る（Slack だけ再送でメールを二重にしない）', { skip: !available }, () => {
  const g = makeGas({ props: PROPS });
  const r = g.post({ action: 'notify_application', secret: SECRET, application, event, send: { mail: false, slack: true } });
  assert.equal(g.calls.mail.length, 0);
  assert.equal(g.calls.slack.length, 1);
  assert.equal(r.mail.skipped, true);
  assert.equal(r.slack.ok, true);
});

test('GAS U9: Slack だけ失敗 → 運営宛メールに切替。slack.ok=true・fallback=mail', { skip: !available }, () => {
  const g = makeGas({ props: PROPS, slack: () => ({ ok: false, error: 'channel_not_found' }) });
  const r = g.post({ action: 'notify_application', secret: SECRET, application, event, send: { mail: true, slack: true } });
  assert.equal(r.mail.ok, true);
  assert.equal(r.slack.ok, true);
  assert.equal(r.slack.fallback, 'mail');
  assert.equal(g.calls.mail.length, 2);
  const fb = g.calls.mail[1];
  assert.equal(fb.to, g.notifyTo);   // 運営宛（申込者宛ではない）
  assert.notEqual(fb.to, 'test@example.com');
  assert.match(fb.body, /Slack通知に失敗したためメールで通知しています/);
  assert.match(fb.body, /受付日時：2026\/09\/28 12:00:00/);
  assert.match(fb.body, /recore-community-portalsite\.vercel\.app\/admin/);
});

test('GAS: メールだけ失敗 → mail.ok=false にエラー、Slack は送る', { skip: !available }, () => {
  const g = makeGas({ props: PROPS, mail: (o) => { if (o.to === 'test@example.com') throw new Error('Service invoked too many times'); } });
  const r = g.post({ action: 'notify_application', secret: SECRET, application, event, send: { mail: true, slack: true } });
  assert.equal(r.ok, true);
  assert.equal(r.mail.ok, false);
  assert.match(r.mail.error, /too many times/);
  assert.equal(r.slack.ok, true);
});

test('GAS U13: シークレット無し・不一致・プロパティ未設定の送信要求は拒否しメールを出さない', { skip: !available }, () => {
  const g = makeGas({ props: PROPS });
  for (const secret of [undefined, '', 'wrong']) {
    const r = g.post({ action: 'notify_application', secret, application, event });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    const c = g.post({ action: 'notify_change', secret, type: 'cancel', application, event });
    assert.equal(c.status, 403);
  }
  assert.equal(g.calls.mail.length, 0);
  assert.equal(g.calls.slack.length, 0);
  const noProp = makeGas({ props: { SLACK_BOT_TOKEN: 'x' } });
  assert.equal(noProp.post({ action: 'notify_application', secret: '', application, event }).status, 403);
  assert.equal(noProp.calls.mail.length, 0);
});

test('GAS U12: action なしの申込（旧 HTML）はサイト API に転送し、シートに書かず、応答をそのまま返す', { skip: !available }, () => {
  const g = makeGas({ props: PROPS, site: () => ({ ok: true, id: 'abc', mailSent: true }) });
  const oldForm = { company: 'テスト株式会社', name: 'テスト 太郎', role: '経営者', email: 'test@example.com', tel: '090-0000-0000',
    attendeeCount: 1, attendees: ['テスト 太郎'], carCount: 0, message: '', eventKey: 'kanto-vol4',
    event: 'クライアントが送ったイベント名', eventDate: 'x', eventPlace: 'y', eventDetail: 'z' };
  const r = g.post(oldForm);
  assert.deepEqual(r, { ok: true, id: 'abc', mailSent: true });
  assert.equal(g.calls.site.length, 1);
  const p = g.calls.site[0];
  assert.equal(p.source, 'gas_forward');
  assert.equal(p.secret, SECRET);
  assert.equal(p.tel, '090-0000-0000');
  assert.equal(p.eventKey, 'kanto-vol4');
  assert.equal(g.calls.mail.length, 0);   // GAS 自身はメールを送らない（API が改めて頼む）
  assert.equal(g.calls.sheet, 0);

  // API の拒否（締切後など）もそのまま返す
  const g2 = makeGas({ props: PROPS, site: () => ({ status: 400, body: { ok: false, code: 'closed', error: '申込受付は終了しました' } }) });
  assert.deepEqual(g2.post(oldForm), { ok: false, code: 'closed', error: '申込受付は終了しました' });

  // 転送先未設定なら ok=false（シートには書かない）
  const g3 = makeGas({ props: { SLACK_BOT_TOKEN: 'x' } });
  const r3 = g3.post(oldForm);
  assert.equal(r3.ok, false);
  assert.equal(g3.calls.sheet, 0);
});

test('GAS U25: 旧 /admin の一覧要求は「移転しました。再読み込みしてください」を返しシートを読まない', { skip: !available }, () => {
  const g = makeGas({ props: PROPS });
  const r = g.post({ action: 'list', idToken: 'anything' });
  assert.equal(r.ok, false);
  assert.match(r.error, /移転しました.*再読み込みしてください/);
  assert.equal(r.events, undefined);
  assert.equal(g.calls.sheet, 0);
});

test('GAS D14: 取消・変更の通知は運営 Slack にだけ（申込者にメールしない）、Slack 失敗時は運営宛メール', { skip: !available }, () => {
  const g = makeGas({ props: PROPS });
  const c = g.post({ action: 'notify_change', secret: SECRET, type: 'cancel', application, event, changed_by: 'editor@example.com', before: { status: 'active' }, after: { status: 'cancelled' } });
  assert.equal(c.ok, true);
  assert.equal(c.slack.ok, true);
  assert.match(g.calls.slack[0].text, /^\*【申込取消】\*/);
  assert.match(g.calls.slack[0].text, /\*操作者：\* editor@example.com/);
  assert.equal(g.calls.mail.length, 0);

  const u = g.post({ action: 'notify_change', secret: SECRET, type: 'update', application, event, changed_by: 'editor@example.com',
    before: { attendees: ['テスト 太郎', 'テスト 花子', 'テスト 次郎'], car_count: 1 }, after: { attendees: ['テスト 太郎', 'テスト 花子', 'テスト 次郎', 'テスト 三郎'], car_count: 2 } });
  assert.equal(u.ok, true);
  assert.match(g.calls.slack[1].text, /^\*【申込変更】\*/);
  assert.match(g.calls.slack[1].text, /\*参加者：\* 3名（.*） → 4名（.*テスト 三郎）/);
  assert.match(g.calls.slack[1].text, /\*お車の台数：\* 1台 → 2台/);
  assert.equal(g.calls.mail.length, 0);

  const g2 = makeGas({ props: PROPS, slack: () => ({ ok: false, error: 'invalid_auth' }) });
  const r2 = g2.post({ action: 'notify_change', secret: SECRET, type: 'cancel', application, event, changed_by: 'editor@example.com' });
  assert.equal(r2.slack.ok, true);
  assert.equal(r2.slack.fallback, 'mail');
  assert.equal(g2.calls.mail.length, 1);
  assert.equal(g2.calls.mail[0].to, g2.notifyTo);
  assert.equal(g2.post({ action: 'notify_change', secret: SECRET, type: 'other', application, event }).ok, false);
});
