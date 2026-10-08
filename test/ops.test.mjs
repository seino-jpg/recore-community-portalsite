// 運営ボード API（docs/designs/2026-10-08-ops-board/design.md の U1〜U18 のうち API で決まるもの）
// DB は検証用（.env.development.local の DATABASE_URL）、Google の tokeninfo はモック。
// 先に検証用 DB へ表を作っておく: DATABASE_URL=<検証用> node scripts/apply-ops-schema.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { handleOps, OPS_EVENT_KEY } from '../api/_lib/ops-core.js';

function loadDevEnv() {
  const p = new URL('../.env.development.local', import.meta.url);
  if (!existsSync(p)) throw new Error('.env.development.local がありません。vercel env pull --environment=development で作ってください');
  const env = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL がありません');
  return env;
}

const sql = neon(loadDevEnv().DATABASE_URL);
const NOW = Date.parse('2026-10-08T12:00:00+09:00');
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
// 架空の設定値（実在のメールを書かない）。社外の運営も閲覧許可リストにいる想定
const ENV = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  ADMIN_EMAILS: 'editor@example.com, outside@example.org',
  ADMIN_EDITOR_EMAILS: 'editor@example.com'
};

function tokenInfo(email, overrides = {}) {
  return {
    iss: 'https://accounts.google.com', aud: CLIENT_ID,
    exp: String(Math.floor((NOW + 3600 * 1000) / 1000)), email_verified: 'true', email, ...overrides
  };
}

const TOKENS = {
  editor: tokenInfo('editor@example.com'),
  outside: tokenInfo('outside@example.org'),
  stranger: tokenInfo('stranger@example.com'),
  expired: tokenInfo('outside@example.org', { exp: String(Math.floor((NOW - 1000) / 1000)) })
};

function ctx(env = ENV) {
  return {
    env,
    now: () => NOW,
    fetch: async (url) => {
      const token = decodeURIComponent(String(url).split('id_token=')[1] || '');
      const info = TOKENS[token];
      return new Response(JSON.stringify(info || { error: 'invalid_token' }), { status: info ? 200 : 400 });
    }
  };
}

const call = (body, env) => handleOps(ctx(env), sql, body);
const as = (who, body) => call({ idToken: who, ...body });

beforeEach(async () => {
  await sql`TRUNCATE ops_tasks, ops_schedule`;
});

async function addTask(fields, who = 'editor') {
  const r = await as(who, { action: 'save', kind: 'task', fields });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.row;
}

async function addSchedule(fields, who = 'editor') {
  const r = await as(who, { action: 'save', kind: 'schedule', fields });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.row;
}

test('U1 社外の運営: 一覧を読め、追加・編集・削除ができる', async () => {
  const t = await addTask({ title: '22番会議室の予約', owner: 'ブックオフ側' }, 'outside');
  assert.equal(t.updated_by, 'outside@example.org');
  const list = await as('outside', { action: 'list' });
  assert.equal(list.status, 200);
  assert.equal(list.body.viewer, 'outside@example.org');
  assert.equal(list.body.tasks.length, 1);
  assert.deepEqual(list.body.schedule, []);
  const u = await as('outside', { action: 'save', kind: 'task', id: t.id, expectedUpdatedAt: t.updated_at, fields: { note: '予約した' } });
  assert.equal(u.status, 200);
  const d = await as('outside', { action: 'delete', kind: 'task', id: t.id });
  assert.equal(d.status, 200);
  assert.equal((await as('outside', { action: 'list' })).body.tasks.length, 0);
});

test('U2 状態だけを変える: 他の項目はそのまま、最終更新者が変わる', async () => {
  const t = await addTask({ title: '22番会議室の予約', owner: 'ブックオフ側', due_date: '2026-10-09', note: 'メモ' });
  const r = await as('outside', { action: 'save', kind: 'task', id: t.id, expectedUpdatedAt: t.updated_at, fields: { status: 'done' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.row.status, 'done');
  assert.equal(r.body.row.title, '22番会議室の予約');
  assert.equal(r.body.row.owner, 'ブックオフ側');
  assert.equal(r.body.row.due_date, '2026-10-09');
  assert.equal(r.body.row.note, 'メモ');
  assert.equal(r.body.row.updated_by, 'outside@example.org');
  assert.notEqual(r.body.row.updated_at, t.updated_at);
});

test('U3 やることだけで追加: 未着手・担当なし・期日なしで入り、期日ありより後に並ぶ', async () => {
  const later = await addTask({ title: '荷物置き場を決める' });
  assert.deepEqual([later.status, later.owner, later.due_date, later.note], ['todo', '', null, '']);
  await addTask({ title: 'しおりを配る', due_date: '2026-10-20' });
  const list = await as('editor', { action: 'list' });
  assert.deepEqual(list.body.tasks.map((x) => x.title), ['しおりを配る', '荷物置き場を決める']);
});

test('U5・U6 予定は開始時刻順。終了なし（時点だけ）も時刻の位置に入る', async () => {
  await addSchedule({ start_time: '11:30', end_time: '12:00', title: '受付・集合' });
  await addSchedule({ start_time: '14:00', end_time: '', title: '22番会議室が使える', owner: 'ブックオフ側', place: '22番会議室' });
  await addSchedule({ start_time: '13:30', end_time: '14:30', title: 'ささげ業務 見学' });
  const r = await addSchedule({ start_time: '10:30', end_time: '11:00', title: 'レンタカー受け取り', owner: '清野', place: '南町田' });
  assert.deepEqual([r.start_time, r.end_time], ['10:30', '11:00']);
  const list = await as('editor', { action: 'list' });
  assert.deepEqual(list.body.schedule.map((x) => `${x.start_time}-${x.end_time ?? ''} ${x.title}`), [
    '10:30-11:00 レンタカー受け取り',
    '11:30-12:00 受付・集合',
    '13:30-14:30 ささげ業務 見学',
    '14:00- 22番会議室が使える'
  ]);
});

test('U7 同じ行を2人が直す: 後の保存は 409 と最新の行。DB は先の人の内容のまま', async () => {
  const t = await addTask({ title: 'レンタカーの予約', owner: '清野' });
  const b = await as('outside', { action: 'save', kind: 'task', id: t.id, expectedUpdatedAt: t.updated_at, fields: { status: 'doing', note: '2台仮押さえ' } });
  assert.equal(b.status, 200);
  const a = await as('editor', { action: 'save', kind: 'task', id: t.id, expectedUpdatedAt: t.updated_at, fields: { status: 'done', note: '予約した' } });
  assert.equal(a.status, 409);
  assert.equal(a.body.conflict, true);
  assert.match(a.body.error, /outside@example\.org が先に/);
  assert.equal(a.body.row.note, '2台仮押さえ');
  assert.equal(a.body.row.updated_at, b.body.row.updated_at);
  const [row] = await sql`SELECT status, note FROM ops_tasks WHERE id = ${t.id}`;
  assert.deepEqual(row, { status: 'doing', note: '2台仮押さえ' });
  // 最新の更新時刻で保存し直せば通る
  const retry = await as('editor', { action: 'save', kind: 'task', id: t.id, expectedUpdatedAt: a.body.row.updated_at, fields: { status: 'done' } });
  assert.equal(retry.status, 200);
  // 更新時刻を送らない保存も重なり扱いで止める
  const none = await as('editor', { action: 'save', kind: 'task', id: t.id, fields: { status: 'todo' } });
  assert.equal(none.status, 409);
});

test('U7 予定も同じく重なりを止める', async () => {
  const s = await addSchedule({ start_time: '11:30', end_time: '12:00', title: '受付・集合' });
  await as('outside', { action: 'save', kind: 'schedule', id: s.id, expectedUpdatedAt: s.updated_at, fields: { start_time: '11:15' } });
  const r = await as('editor', { action: 'save', kind: 'schedule', id: s.id, expectedUpdatedAt: s.updated_at, fields: { title: '受付' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.row.start_time, '11:15');
});

test('U8 許可リスト外・期限切れ・トークンなし・設定漏れは 403 で何も返さない', async () => {
  await addTask({ title: 'しおりを配る' });
  for (const idToken of ['stranger', 'expired', undefined, 'garbage']) {
    const r = await call({ idToken, action: 'list' });
    assert.equal(r.status, 403, String(idToken));
    assert.equal(r.body.tasks, undefined);
  }
  const w = await as('stranger', { action: 'save', kind: 'task', fields: { title: '書けてはいけない' } });
  assert.equal(w.status, 403);
  // U17 プレビュー相当（許可リストが無い環境）
  const p = await call({ idToken: 'editor', action: 'list' }, { GOOGLE_CLIENT_ID: CLIENT_ID });
  assert.equal(p.status, 403);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM ops_tasks`;
  assert.equal(n, 1);
});

test('U9 期限切れで保存: 403 で保存されず、再ログイン後（新しいトークン）なら同じ内容で保存できる', async () => {
  const t = await addTask({ title: 'しおりを配る' });
  const body = { action: 'save', kind: 'task', id: t.id, expectedUpdatedAt: t.updated_at, fields: { status: 'done' } };
  const r = await as('expired', body);
  assert.equal(r.status, 403);
  assert.match(r.body.error, /有効期限/);
  const again = await as('outside', body);
  assert.equal(again.status, 200);
});

test('U13 削除: 消える。すでに無い行の削除も成功、無い行の更新は 404', async () => {
  const t = await addTask({ title: 'しおりを配る' });
  assert.equal((await as('editor', { action: 'delete', kind: 'task', id: t.id })).status, 200);
  assert.equal((await as('outside', { action: 'delete', kind: 'task', id: t.id })).status, 200);
  const u = await as('outside', { action: 'save', kind: 'task', id: t.id, expectedUpdatedAt: t.updated_at, fields: { status: 'done' } });
  assert.equal(u.status, 404);
  assert.match(u.body.error, /削除されています/);
});

test('U14 入力の誤りは保存しない（字数・時刻の前後・空・形式）', async () => {
  const cases = [
    ['task', { title: 'あ'.repeat(101) }, /100字/],
    ['task', { title: '' }, /やること/],
    ['task', { title: '   ' }, /やること/],
    ['task', { title: 'x', owner: 'あ'.repeat(51) }, /担当/],
    ['task', { title: 'x', note: 'あ'.repeat(1001) }, /メモ/],
    ['task', { title: 'x', due_date: '2026-02-30' }, /期日/],
    ['task', { title: 'x', status: 'archived' }, /状態/],
    ['schedule', { start_time: '', title: '受付' }, /開始時刻/],
    ['schedule', { start_time: '25:00', title: '受付' }, /開始時刻/],
    ['schedule', { start_time: '12:00', end_time: '11:59', title: '受付' }, /終了時刻/],
    ['schedule', { start_time: '12:00', title: '' }, /内容/],
    ['schedule', { start_time: '12:00', title: 'x', place: 'あ'.repeat(51) }, /場所/]
  ];
  for (const [kind, fields, re] of cases) {
    const r = await as('editor', { action: 'save', kind, fields });
    assert.equal(r.status, 400, JSON.stringify(fields).slice(0, 60));
    assert.match(r.body.error, re);
  }
  // 上限ちょうどは通る（絵文字はサロゲートペアでも1字）
  await addTask({ title: '😀'.repeat(100), owner: 'あ'.repeat(50), note: 'あ'.repeat(1000) });
  await addSchedule({ start_time: '12:00', end_time: '12:00', title: 'x'.repeat(100), place: 'あ'.repeat(50) });
  const [{ n }] = await sql`SELECT (SELECT count(*) FROM ops_tasks) + (SELECT count(*) FROM ops_schedule) AS n`;
  assert.equal(Number(n), 2);
});

test('U16 メモの改行・タグは文字のまま保存する（表示側で解釈しない）', async () => {
  const t = await addTask({ title: '<b>太字</b>', note: '1行目\n<script>alert(1)</script>\n3行目\n' });
  assert.equal(t.title, '<b>太字</b>');
  assert.equal(t.note, '1行目\n<script>alert(1)</script>\n3行目');
});

test('Vol.4 以外の行は読まず、書けない（D1）', async () => {
  await sql`INSERT INTO ops_tasks (event_key, title, updated_by) VALUES ('kansai-vol2', '関西の行', 'x')`;
  const [other] = await sql`SELECT id, updated_at FROM ops_tasks WHERE event_key = 'kansai-vol2'`;
  assert.equal((await as('editor', { action: 'list' })).body.tasks.length, 0);
  const u = await as('editor', { action: 'save', kind: 'task', id: other.id, expectedUpdatedAt: new Date(other.updated_at).toISOString(), fields: { title: '書き換え' } });
  assert.equal(u.status, 404);
  await as('editor', { action: 'delete', kind: 'task', id: other.id });
  const [still] = await sql`SELECT title FROM ops_tasks WHERE id = ${other.id}`;
  assert.equal(still.title, '関西の行');
  assert.equal(OPS_EVENT_KEY, 'kanto-vol4');
});

test('不正な action・種類・id', async () => {
  assert.equal((await as('editor', { action: 'drop' })).status, 400);
  assert.equal((await as('editor', { action: 'save', kind: 'user', fields: {} })).status, 400);
  assert.equal((await as('editor', { action: 'save', kind: 'task', id: 'not-a-uuid', fields: {} })).status, 400);
  assert.equal((await as('editor', { action: 'delete', kind: 'task', id: "1' OR '1'='1" })).status, 400);
});

test('U18 初期データ: 準備9件（完了2・未着手7）と予定9件。2回流しても増えない', async () => {
  const seed = readFileSync(new URL('../db/ops-seed.sql', import.meta.url), 'utf8')
    .split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
  for (let i = 0; i < 2; i++) for (const stmt of seed) await sql.query(stmt);
  const list = await as('outside', { action: 'list' });
  assert.equal(list.body.tasks.length, 9);
  assert.equal(list.body.tasks.filter((x) => x.status === 'done').length, 2);
  assert.equal(list.body.tasks.filter((x) => x.status === 'todo').length, 7);
  assert.equal(list.body.schedule.length, 9);
  assert.equal(list.body.schedule[0].start_time, '11:30');
  assert.ok(list.body.tasks.every((x) => x.updated_by === 'seed'));
});
