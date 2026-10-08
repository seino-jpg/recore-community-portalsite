// 申込管理 API（POST /api/admin）。処理の本体は _lib/admin-core.js
// 個人情報を返すため、ID トークン検証を通らないリクエストには何も返さない
import { createContext } from './_lib/context.js';
import { getSql } from './_lib/db.js';
import { readJsonBody, sendJson, methodNotAllowed } from './_lib/http.js';
import { handleAdmin } from './_lib/admin-core.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  try {
    const body = await readJsonBody(req);
    const { status, body: out } = await handleAdmin(createContext(), getSql(), body);
    sendJson(res, status, out);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: '処理に失敗しました' });
  }
}
