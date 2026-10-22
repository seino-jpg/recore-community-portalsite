// 参加者アンケートの受付の本体（2026-10-22-event-survey の D1〜D6・D8）。api/survey.js から呼ぶ。
// 設問は events.json の survey が正本。クライアントが送る設問文や選択肢は使わない。
// 戻り値: { status, body }
import { getEvent, isClosed } from './events.js';
import { isUuid } from './validate.js';
import { isSlackConfigured, postToSlack } from './slack.js';
import { formatJst } from './db.js';
import { ADMIN_URL } from './messages.js';

export const TEXT_MAX = 100;
export const TEXTAREA_MAX = 2000;
const SLACK_EXCERPT = 200;

/** アンケートのあるイベントだけ返す。無ければ null */
export function getSurveyEvent(key) {
  const ev = getEvent(key);
  return ev && ev.survey ? ev : null;
}

export async function handleSurvey(ctx, sql, body) {
  const data = body && typeof body === 'object' ? body : null;
  if (!data) return reply(400, { ok: false, error: 'リクエスト本文がありません' });

  const token = data.submission_token;
  if (!isUuid(token)) {
    return reply(400, { ok: false, error: '送信情報が不正です。ページを再読み込みしてお試しください' });
  }

  const ev = getSurveyEvent(data.eventKey);
  if (!ev) return reply(400, { ok: false, error: '対象のアンケートが見つかりません' });
  // 締切の規則は申込と同じ（D8）
  if (isClosed({ deadline: ev.survey.deadline }, ctx.now())) {
    return reply(400, { ok: false, code: 'closed', error: 'アンケートの受付は終了しました' });
  }

  const questions = ev.survey.questions;
  const v = validateAnswers(questions, data.answers);
  if (!v.ok) return reply(400, { ok: false, error: v.error });

  let row;
  try {
    const inserted = await sql`
      INSERT INTO survey_responses (submission_token, event_key, answers, questions, received_at)
      VALUES (${token}, ${ev.key}, ${JSON.stringify(v.answers)}::jsonb, ${JSON.stringify(questions)}::jsonb,
              ${new Date(ctx.now()).toISOString()}::timestamptz)
      ON CONFLICT (submission_token) DO NOTHING
      RETURNING *
    `;
    if (inserted.length === 0) {
      // 同じトークンの再送（連打・リトライ）。保存も通知もせず同じ結果を返す（D4）
      const [existing] = await sql`SELECT id FROM survey_responses WHERE submission_token = ${token}`;
      return reply(200, { ok: true, id: existing.id, duplicate: true });
    }
    row = inserted[0];
  } catch (err) {
    console.error('DB 保存に失敗', err);
    return reply(500, { ok: false, error: '送信に失敗しました' });
  }

  // 保存できた時点で回答は成立。Slack の失敗は行に残すだけで再送しない（D6）
  try {
    await notifySlack(ctx, sql, ev, row);
  } catch (err) {
    console.error('Slack 通知の記録に失敗', err);
  }
  return reply(200, { ok: true, id: row.id });
}

/**
 * 設問定義に照らして答えを検証する（D5）。定義に無い項目は捨てる。
 * 戻り値: { ok: true, answers } または { ok: false, error }
 */
export function validateAnswers(questions, input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const answers = {};
  for (const q of questions) {
    const raw = src[q.id];
    if (q.type === 'text' || q.type === 'textarea') {
      const s = typeof raw === 'string' ? raw.trim() : '';
      const max = q.type === 'text' ? TEXT_MAX : TEXTAREA_MAX;
      if (q.required && !s) return missing();
      if (s.length > max) return { ok: false, error: `「${q.label}」は${max}文字以内でご入力ください` };
      answers[q.id] = s;
    } else if (q.type === 'scale') {
      if (raw == null || raw === '') {
        if (q.required) return missing();
        answers[q.id] = null;
        continue;
      }
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < q.min || n > q.max) return invalid(q);
      answers[q.id] = n;
    } else if (q.type === 'radio') {
      const s = typeof raw === 'string' ? raw : '';
      if (!s) {
        if (q.required) return missing();
        answers[q.id] = '';
        continue;
      }
      if (!q.options.includes(s)) return invalid(q);
      answers[q.id] = s;
    } else if (q.type === 'checkbox') {
      if (raw != null && !Array.isArray(raw)) return invalid(q);
      const list = raw || [];
      if (list.some((s) => !q.options.includes(s))) return invalid(q);
      // 並びは選択肢の順にそろえる（集計・一覧で読みやすく）
      const picked = q.options.filter((o) => list.includes(o));
      if (q.required && picked.length === 0) return missing();
      answers[q.id] = picked;
    } else {
      throw new Error('未対応の設問の種類です: ' + q.type);
    }
  }
  return { ok: true, answers };
}

/**
 * 運営 Slack への回答通知の文面。会社名・お名前・満足度・参考になった内容・感想の先頭（design ③）。
 * 設問 id で引くので、別のイベントでも同じ id を使えば同じ形で流れる。定義に無い id の行は出さない。
 */
export function surveySlackText(ev, questions, answers, receivedAt) {
  const has = (id) => questions.some((q) => q.id === id);
  const lines = ['*【アンケート回答】* ' + ev.name, ''];
  if (has('company')) lines.push('*会社名：* ' + answers.company);
  if (has('name')) lines.push('*お名前：* ' + answers.name);
  if (has('satisfaction')) {
    const q = questions.find((x) => x.id === 'satisfaction');
    lines.push('*満足度：* ' + (answers.satisfaction == null ? '未回答' : answers.satisfaction + ' / ' + q.max));
  }
  if (has('helpful')) lines.push('*参考になった内容：* ' + (answers.helpful.length ? answers.helpful.join('、') : 'なし'));
  if (has('impression')) {
    const t = answers.impression || 'なし';
    lines.push('*感想：* ' + (t.length > SLACK_EXCERPT ? t.slice(0, SLACK_EXCERPT) + '…' : t));
  }
  lines.push('*回答日時：* ' + formatJst(receivedAt, false));
  lines.push('');
  lines.push('<' + ADMIN_URL + '/survey|アンケートの回答を開く>');
  return lines.join('\n');
}

async function notifySlack(ctx, sql, ev, row) {
  // 設定が無い環境（プレビュー）では送らない。未通知のまま残す
  if (!isSlackConfigured(ctx.env)) return;
  const r = await postToSlack(ctx, surveySlackText(ev, row.questions, row.answers, row.received_at));
  if (r.ok) {
    await sql`UPDATE survey_responses SET slack_sent_at = ${new Date(ctx.now()).toISOString()}::timestamptz, slack_error = NULL WHERE id = ${row.id}`;
  } else {
    await sql`UPDATE survey_responses SET slack_error = ${r.error} WHERE id = ${row.id}`;
  }
}

function missing() {
  return { ok: false, error: '必須項目が入力されていません' };
}

function invalid(q) {
  return { ok: false, error: `「${q.label}」の回答が不正です` };
}

function reply(status, body) {
  return { status, body };
}
