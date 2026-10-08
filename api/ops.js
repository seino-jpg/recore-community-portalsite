// 運営ボード API（POST /api/ops）。処理の本体は _lib/ops-core.js
// ID トークン検証を通らないリクエストには何も返さない
import { createContext } from './_lib/context.js';
import { getSql } from './_lib/db.js';
import { readJsonBody, sendJson, methodNotAllowed } from './_lib/http.js';
import { handleOps } from './_lib/ops-core.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  try {
    const body = await readJsonBody(req);
    const { status, body: out } = await handleOps(createContext(), getSql(), body);
    sendJson(res, status, out);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: '処理に失敗しました' });
  }
}
