// 参加者アンケート API（docs/designs/2026-10-22-event-survey/design.md の U1〜U12）
// 先に検証用 DB へ表を作っておく: DATABASE_URL=<検証用> node scripts/apply-survey-schema.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql, resetDb, makeCtx, mockFetch, tokenInfo, PREVIEW_ENV } from './helpers.mjs';
import { handleSurvey, validateAnswers, getSurveyEvent } from '../api/_lib/survey-core.js';
import { handleSurveyAdmin } from '../api/_lib/survey-admin-core.js';

beforeEach(resetDb);

const NOW = Date.parse('2026-10-22T17:00:00+09:00');
const QUESTIONS = getSurveyEvent('kanto-vol4').survey.questions;

function fullAnswers(overrides = {}) {
  return {
    company: 'テスト株式会社',
    name: 'テスト 太郎',
    satisfaction: 9,
    satisfaction_reason: '現場を間近で見られた',
    helpful: ['ささげ業務の見学', 'ピッキング業務の見学'],
    helpful_reason: '撮影の手順',
    adopt: '採寸の型紙',
    time_allocation: 'ちょうどよかった',
    operation: '',
    next_participation: 'ぜひ参加したい',
    next_theme: '買取の現場',
    request: '一括編集',
    impression: 'ありがとうございました',
    ...overrides
  };
}

function requiredOnly() {
  return { company: 'テスト株式会社', name: 'テスト 花子', satisfaction: '8', helpful: ['メディア倉庫の見学'], time_allocation: '長く感じた', next_participation: '日程が合えば参加したい' };
}

function input(answers, overrides = {}) {
  return { submission_token: crypto.randomUUID(), eventKey: 'kanto-vol4', answers, ...overrides };
}

const ctxAt = (now, fetch = mockFetch()) => makeCtx({ fetch, now: () => now });

test('U1 通常: 13問を保存・Slack に1件・slack_sent_at', async () => {
  const fetch = mockFetch();
  const r = await handleSurvey(ctxAt(NOW, fetch), sql, input(fullAnswers()));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const rows = await sql`SELECT * FROM survey_responses`;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.event_key, 'kanto-vol4');
  assert.equal(Object.keys(row.answers).length, 13);
  // 複数選択は選択肢の順にそろう
  assert.deepEqual(row.answers.helpful, ['ピッキング業務の見学', 'ささげ業務の見学']);
  assert.equal(row.answers.satisfaction, 9);
  assert.equal(row.questions.length, 13);
  assert.ok(row.slack_sent_at);
  assert.equal(row.slack_error, null);
  assert.equal(fetch.calls.slack.length, 1);
  const t = fetch.calls.slack[0].text;
  assert.match(t, /^\*【アンケート回答】\* 関東コミュニティ第4回イベント/);
  assert.match(t, /\*会社名：\* テスト株式会社\n\*お名前：\* テスト 太郎\n\*満足度：\* 9 \/ 10\n\*参考になった内容：\* ピッキング業務の見学、ささげ業務の見学\n\*感想：\* ありがとうございました\n\*回答日時：\* 2026\/10\/22 17:00\n/);
  assert.match(t, /<https:\/\/recore-community-portalsite.vercel.app\/admin\/survey\|/);
});

test('U2 任意を空: 必須6問だけで保存。任意は空文字・空配列', async () => {
  const r = await handleSurvey(ctxAt(NOW), sql, input(requiredOnly()));
  assert.equal(r.status, 200);
  const [row] = await sql`SELECT answers FROM survey_responses`;
  assert.equal(row.answers.satisfaction, 8);
  assert.equal(row.answers.impression, '');
  assert.equal(row.answers.operation, '');
  assert.equal(Object.keys(row.answers).length, 13);
});

test('U3 必須漏れ: 参考になった内容が0件は 400・保存しない', async () => {
  const r = await handleSurvey(ctxAt(NOW), sql, input(fullAnswers({ helpful: [] })));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, '必須項目が入力されていません');
  for (const id of ['company', 'name', 'satisfaction', 'time_allocation', 'next_participation']) {
    const a = fullAnswers();
    delete a[id];
    assert.equal((await handleSurvey(ctxAt(NOW), sql, input(a))).status, 400, id);
  }
  assert.equal((await sql`SELECT count(*)::int AS n FROM survey_responses`)[0].n, 0);
});

test('U4 範囲外: 満足度 11・0・小数、定義外の選択肢は 400', async () => {
  for (const a of [
    { satisfaction: 11 }, { satisfaction: 0 }, { satisfaction: 8.5 }, { satisfaction: '9点' },
    { time_allocation: '短く感じた' }, { helpful: ['倉庫の見学'] }, { helpful: 'ピッキング業務の見学' }
  ]) {
    const r = await handleSurvey(ctxAt(NOW), sql, input(fullAnswers(a)));
    assert.equal(r.status, 400, JSON.stringify(a));
    assert.match(r.body.error, /の回答が不正です$/);
  }
  assert.equal((await sql`SELECT count(*)::int AS n FROM survey_responses`)[0].n, 0);
});

test('U5 長すぎ: 段落 2001字・記述 101字は 400、2000字・100字は通る', async () => {
  assert.equal((await handleSurvey(ctxAt(NOW), sql, input(fullAnswers({ impression: 'あ'.repeat(2001) })))).status, 400);
  assert.equal((await handleSurvey(ctxAt(NOW), sql, input(fullAnswers({ company: 'あ'.repeat(101) })))).status, 400);
  const r = await handleSurvey(ctxAt(NOW), sql, input(fullAnswers({ impression: 'あ'.repeat(2000), company: 'あ'.repeat(100) })));
  assert.equal(r.status, 200);
  const [row] = await sql`SELECT answers FROM survey_responses`;
  assert.equal(row.answers.impression.length, 2000);
});

test('U6 二重送信: 同じトークンは1件・Slack も1件', async () => {
  const fetch = mockFetch();
  const body = input(fullAnswers());
  const a = await handleSurvey(ctxAt(NOW, fetch), sql, body);
  const b = await handleSurvey(ctxAt(NOW, fetch), sql, body);
  assert.equal(b.status, 200);
  assert.equal(b.body.duplicate, true);
  assert.equal(b.body.id, a.body.id);
  assert.equal((await sql`SELECT count(*)::int AS n FROM survey_responses`)[0].n, 1);
  assert.equal(fetch.calls.slack.length, 1);
});

test('U7 締切: 10/31 23:59:58 は受付、23:59:59 は closed', async () => {
  const ok = await handleSurvey(ctxAt(Date.parse('2026-10-31T23:59:58+09:00')), sql, input(fullAnswers()));
  assert.equal(ok.status, 200);
  const ng = await handleSurvey(ctxAt(Date.parse('2026-10-31T23:59:59+09:00')), sql, input(fullAnswers()));
  assert.equal(ng.status, 400);
  assert.equal(ng.body.code, 'closed');
});

test('U8 アンケート無し: survey 未定義のイベント・未知の key・トークン不正は 400', async () => {
  for (const eventKey of ['kansai-vol2', 'unknown', undefined]) {
    const r = await handleSurvey(ctxAt(NOW), sql, input(fullAnswers(), { eventKey }));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '対象のアンケートが見つかりません');
  }
  assert.equal((await handleSurvey(ctxAt(NOW), sql, input(fullAnswers(), { submission_token: 'x' }))).status, 400);
  assert.equal((await handleSurvey(ctxAt(NOW), sql, null)).status, 400);
});

test('U9 Slack 失敗: 回答は 200 で保存し slack_error に理由。未設定（プレビュー）は送らず未通知', async () => {
  const fetch = mockFetch({ slack: () => ({ ok: false, error: 'channel_not_found' }) });
  const r = await handleSurvey(ctxAt(NOW, fetch), sql, input(fullAnswers()));
  assert.equal(r.status, 200);
  const [row] = await sql`SELECT * FROM survey_responses`;
  assert.equal(row.slack_sent_at, null);
  assert.match(row.slack_error, /channel_not_found/);

  const pf = mockFetch();
  const p = await handleSurvey(makeCtx({ env: PREVIEW_ENV, fetch: pf, now: () => NOW }), sql, input(fullAnswers()));
  assert.equal(p.status, 200);
  assert.equal(pf.calls.slack.length, 0);
  const rows = await sql`SELECT * FROM survey_responses WHERE slack_error IS NULL`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slack_sent_at, null);
});

const ADMIN_NOW = Date.parse('2026-09-28T12:00:00+09:00'); // helpers の tokenInfo の有効期限内
const adminCtx = () => makeCtx({
  fetch: mockFetch({ tokens: { viewer: tokenInfo('viewer@example.com'), stranger: tokenInfo('stranger@example.com') } }),
  now: () => ADMIN_NOW
});

test('U10 集計: 満足度 8・10・9 → 平均 9.0・分布、ピッキング 2件', async () => {
  // 回答日時をずらして並び（古い順）を決める。同じ時刻だと id 順になり一定しない
  const answers = [[8, ['ピッキング業務の見学']], [10, ['ピッキング業務の見学', 'メディア倉庫の見学']], [9, ['振り返り・質疑応答']]];
  for (const [i, [s, helpful]] of answers.entries()) {
    await handleSurvey(ctxAt(NOW + i * 1000), sql, input(fullAnswers({ satisfaction: s, helpful })));
  }
  const r = await handleSurveyAdmin(adminCtx(), sql, { idToken: 'viewer', action: 'list' });
  assert.equal(r.status, 200);
  const ev = r.body.events.find((e) => e.key === 'kanto-vol4');
  assert.ok(ev);
  assert.equal(r.body.events.some((e) => e.key === 'kansai-vol2'), false);
  assert.equal(ev.summary.count, 3);
  assert.equal(ev.summary.questions.satisfaction.average, 9);
  assert.deepEqual([8, 9, 10].map((n) => ev.summary.questions.satisfaction.distribution[n]), [1, 1, 1]);
  assert.equal(ev.summary.questions.satisfaction.distribution[1], 0);
  const helpful = ev.summary.questions.helpful.counts;
  assert.equal(helpful.find((c) => c.option === 'ピッキング業務の見学').count, 2);
  assert.equal(helpful.find((c) => c.option === 'ささげ業務の見学').count, 0);
  assert.equal(ev.summary.questions.time_allocation.counts[0].count, 3);
  assert.equal(ev.rows.length, 3);
  assert.equal(ev.rows[0].answers.satisfaction, 8);
  assert.ok(ev.rows[0].slack_sent_at);
});

test('U11 権限: 許可リストに無いアカウント・トークン無しは 403', async () => {
  await handleSurvey(ctxAt(NOW), sql, input(fullAnswers()));
  for (const idToken of ['stranger', 'nope', undefined]) {
    const r = await handleSurveyAdmin(adminCtx(), sql, { idToken, action: 'list' });
    assert.equal(r.status, 403);
    assert.equal(r.body.events, undefined);
  }
});

test('U12 設問を後で直す: 写しの文言と回答の値はそのまま、件数は後ろに足す', async () => {
  // 回答時点の定義（Q8 の選択肢が今と違う）で保存された行を作る
  const old = QUESTIONS.map((q) => (q.id === 'time_allocation' ? { ...q, options: ['ちょうどよい', 'もっと長く見たかった', '長く感じた'] } : q));
  const v = validateAnswers(old, fullAnswers({ time_allocation: 'ちょうどよい' }));
  assert.equal(v.ok, true);
  await sql`INSERT INTO survey_responses (submission_token, event_key, answers, questions)
    VALUES (${crypto.randomUUID()}, 'kanto-vol4', ${JSON.stringify(v.answers)}::jsonb, ${JSON.stringify(old)}::jsonb)`;
  const r = await handleSurveyAdmin(adminCtx(), sql, { idToken: 'viewer', action: 'list' });
  const ev = r.body.events.find((e) => e.key === 'kanto-vol4');
  const row = ev.rows[0];
  assert.equal(row.answers.time_allocation, 'ちょうどよい');
  assert.deepEqual(row.questions.find((q) => q.id === 'time_allocation').options, old.find((q) => q.id === 'time_allocation').options);
  const counts = ev.summary.questions.time_allocation.counts;
  assert.deepEqual(counts.map((c) => c.option), ['ちょうどよかった', 'もっと長く見たかった', '長く感じた', 'ちょうどよい']);
  assert.equal(counts[3].count, 1);
});
