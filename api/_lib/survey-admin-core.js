// /admin/survey 向け API の本体（2026-10-22-event-survey の D7）。api/survey-admin.js から呼ぶ。
// 閲覧の許可リストで見られる。回答は参加者の言葉なので、書き換え・削除の操作は持たない。
// 戻り値: { status, body }
import { authenticateAdmin } from './auth.js';
import { listEvents } from './events.js';
import { toSurveyResponseView } from './db.js';

export async function handleSurveyAdmin(ctx, sql, body) {
  const data = body && typeof body === 'object' ? body : {};
  const auth = await authenticateAdmin(data.idToken, ctx);
  if (!auth.ok) return reply(403, { ok: false, error: auth.error });

  const action = String(data.action || '');
  if (action === 'list') {
    return reply(200, { ok: true, viewer: auth.email, events: await listAll(sql) });
  }
  return reply(400, { ok: false, error: '不明な action です: ' + action });
}

/**
 * 設問ごとの集計。scale は平均（小数1桁）と分布、radio・checkbox は選択肢ごとの件数。
 * 件数は今の定義の選択肢の順に並べ、定義に無くなった値（文言を直す前の回答）は後ろに足す。
 */
export function summarizeSurvey(questions, rows) {
  const result = { count: rows.length, questions: {} };
  for (const q of questions) {
    const values = rows.map((r) => r.answers[q.id]);
    if (q.type === 'scale') {
      const nums = values.filter((v) => Number.isInteger(v));
      const distribution = {};
      for (let i = q.min; i <= q.max; i++) distribution[i] = nums.filter((n) => n === i).length;
      const average = nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10 : null;
      result.questions[q.id] = { answered: nums.length, average, distribution };
    } else if (q.type === 'radio' || q.type === 'checkbox') {
      const picked = values.flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []));
      const counts = q.options.map((o) => ({ option: o, count: 0 }));
      for (const p of picked) {
        let c = counts.find((x) => x.option === p);
        if (!c) counts.push((c = { option: p, count: 0 }));
        c.count++;
      }
      result.questions[q.id] = { answered: values.filter((v) => (Array.isArray(v) ? v.length : v)).length, counts };
    }
  }
  return result;
}

async function listAll(sql) {
  const rows = await sql`SELECT * FROM survey_responses ORDER BY received_at, id`;
  return listEvents()
    .filter((ev) => ev.survey)
    .map((ev) => {
      const mine = rows.filter((r) => r.event_key === ev.key);
      return {
        key: ev.key,
        name: ev.name,
        deadline: ev.survey.deadline,
        questions: ev.survey.questions,
        summary: summarizeSurvey(ev.survey.questions, mine),
        rows: mine.map(toSurveyResponseView)
      };
    });
}

function reply(status, body) {
  return { status, body };
}
