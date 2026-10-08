// Vercel Functions（Node.js・(req, res) 形式）向けの薄い共通処理

export async function readJsonBody(req) {
  // Vercel の Node ランタイムは Content-Type に応じて req.body を入れる（JSON→object、text/plain→string）。
  // ローカルのテストサーバーでは生のストリームを読む。
  let raw = req.body;
  if (raw === undefined) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  } catch {
    return null;
  }
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
}

// 一定時間で fetch を打ち切る（送信先が応答しないとき U8 に落とす）
export async function fetchWithTimeout(fetchFn, url, init, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}
