// 参加者アンケートの受付 API（POST /api/survey）。処理の本体は _lib/survey-core.js
import { createContext } from './_lib/context.js';
import { getSql } from './_lib/db.js';
import { readJsonBody, sendJson, methodNotAllowed } from './_lib/http.js';
import { handleSurvey } from './_lib/survey-core.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  try {
    const body = await readJsonBody(req);
    const { status, body: out } = await handleSurvey(createContext(), getSql(), body);
    sendJson(res, status, out);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: '送信に失敗しました' });
  }
}
