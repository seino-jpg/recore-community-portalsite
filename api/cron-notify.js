// 未通知の申込を再送する Cron（D8）。vercel.json の crons で10分おきに GET される。
// Vercel は環境変数 CRON_SECRET の値を Authorization: Bearer <値> で送る。無ければ 401。
import { createContext } from './_lib/context.js';
import { getSql } from './_lib/db.js';
import { sendJson, methodNotAllowed } from './_lib/http.js';
import { runCron } from './_lib/cron-core.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  const secret = process.env.CRON_SECRET;
  const auth = req.headers && req.headers.authorization;
  if (!secret || auth !== `Bearer ${secret}`) {
    return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
  }
  try {
    const result = await runCron(createContext(), getSql());
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
  }
}
