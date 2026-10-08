// 運営ボード API の本体（docs/designs/2026-10-08-ops-board/design.md）。api/ops.js から呼ぶ。
// 戻り値: { status, body }
import { authenticateAdmin } from './auth.js';

// Vol.4 専用（D1）。画面からは選ばせない
export const OPS_EVENT_KEY = 'kanto-vol4';

const STATUSES = ['todo', 'doing', 'done'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 画面に返す列。date・time は文字列にして返す（ドライバの Date 変換でずれないように）
const TASK_COLUMNS = `id, title, owner, to_char(due_date, 'YYYY-MM-DD') AS due_date, status, note, updated_at, updated_by`;
const SCHEDULE_COLUMNS = `id, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time, title, owner, place, note, updated_at, updated_by`;

export async function handleOps(ctx, sql, body) {
  const data = body && typeof body === 'object' ? body : {};
  // 見る・編集するのは /admin の閲覧許可リスト全員（D3）
  const auth = await authenticateAdmin(data.idToken, ctx);
  if (!auth.ok) return reply(403, { ok: false, error: auth.error });

  const action = String(data.action || '');
  if (action === 'list') {
    return reply(200, { ok: true, viewer: auth.email, ...(await listAll(sql)) });
  }
  if (action === 'save' || action === 'delete') {
    const table = tableOf(data.kind);
    if (!table) return reply(400, { ok: false, error: '種類が指定されていません' });
    if (action === 'delete') return remove(sql, table, data.id);
    return save(sql, table, data, auth.email);
  }
  return reply(400, { ok: false, error: '不明な action です: ' + action });
}

function tableOf(kind) {
  if (kind === 'task') return { name: 'ops_tasks', columns: TASK_COLUMNS, normalize: normalizeTask, label: '準備事項' };
  if (kind === 'schedule') return { name: 'ops_schedule', columns: SCHEDULE_COLUMNS, normalize: normalizeSchedule, label: '予定' };
  return null;
}

async function listAll(sql) {
  const tasks = await sql.query(
    `SELECT ${TASK_COLUMNS} FROM ops_tasks WHERE event_key = $1 ORDER BY due_date NULLS LAST, created_at, id`, [OPS_EVENT_KEY]);
  const schedule = await sql.query(
    `SELECT ${SCHEDULE_COLUMNS} FROM ops_schedule WHERE event_key = $1 ORDER BY start_time, end_time NULLS FIRST, created_at, id`, [OPS_EVENT_KEY]);
  return { tasks: tasks.map(toView), schedule: schedule.map(toView) };
}

/**
 * 追加（id なし）か1行の更新（id あり）。
 * 更新は data.fields にある項目だけ変える（状態のワンタップ変更は status だけ送る）。
 * 読み込んだときの更新時刻 data.expectedUpdatedAt と DB の値が違えば保存せず、409 と最新の行を返す（D6）。
 */
async function save(sql, table, data, actor) {
  const fields = data.fields && typeof data.fields === 'object' ? data.fields : {};

  if (data.id === undefined || data.id === null || data.id === '') {
    const checked = table.normalize(fields, null);
    if (checked.error) return reply(400, { ok: false, error: checked.error });
    const v = checked.value;
    const rows = table.name === 'ops_tasks'
      ? await sql.query(
        `INSERT INTO ops_tasks (event_key, title, owner, due_date, status, note, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${TASK_COLUMNS}`,
        [OPS_EVENT_KEY, v.title, v.owner, v.due_date, v.status, v.note, actor])
      : await sql.query(
        `INSERT INTO ops_schedule (event_key, start_time, end_time, title, owner, place, note, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${SCHEDULE_COLUMNS}`,
        [OPS_EVENT_KEY, v.start_time, v.end_time, v.title, v.owner, v.place, v.note, actor]);
    return reply(200, { ok: true, row: toView(rows[0]) });
  }

  if (!isUuid(data.id)) return reply(400, { ok: false, error: '対象が指定されていません' });
  const current = await findRow(sql, table, data.id);
  if (!current) return reply(404, { ok: false, error: `この${table.label}は削除されています。再読込してください` });
  if (!sameInstant(current.updated_at, data.expectedUpdatedAt)) return conflict(current);

  const checked = table.normalize(fields, current);
  if (checked.error) return reply(400, { ok: false, error: checked.error });
  const v = checked.value;
  // 更新時刻が読み込んだときのままの行だけ更新する。間に他の人が保存していれば0行になる
  const rows = table.name === 'ops_tasks'
    ? await sql.query(
      `UPDATE ops_tasks SET title = $3, owner = $4, due_date = $5, status = $6, note = $7,
         updated_by = $8, updated_at = date_trunc('milliseconds', now())
       WHERE id = $1 AND updated_at = $2::timestamptz RETURNING ${TASK_COLUMNS}`,
      [data.id, data.expectedUpdatedAt, v.title, v.owner, v.due_date, v.status, v.note, actor])
    : await sql.query(
      `UPDATE ops_schedule SET start_time = $3, end_time = $4, title = $5, owner = $6, place = $7, note = $8,
         updated_by = $9, updated_at = date_trunc('milliseconds', now())
       WHERE id = $1 AND updated_at = $2::timestamptz RETURNING ${SCHEDULE_COLUMNS}`,
      [data.id, data.expectedUpdatedAt, v.start_time, v.end_time, v.title, v.owner, v.place, v.note, actor]);
  if (rows.length === 0) {
    const latest = await findRow(sql, table, data.id);
    if (!latest) return reply(404, { ok: false, error: `この${table.label}は削除されています。再読込してください` });
    return conflict(latest);
  }
  return reply(200, { ok: true, row: toView(rows[0]) });
}

// 削除は確認のうえ消す（D8）。すでに無ければ消えた扱いで成功を返す
async function remove(sql, table, id) {
  if (!isUuid(id)) return reply(400, { ok: false, error: '対象が指定されていません' });
  await sql.query(`DELETE FROM ${table.name} WHERE id = $1 AND event_key = $2`, [id, OPS_EVENT_KEY]);
  return reply(200, { ok: true, id });
}

async function findRow(sql, table, id) {
  const rows = await sql.query(`SELECT ${table.columns} FROM ${table.name} WHERE id = $1 AND event_key = $2`, [id, OPS_EVENT_KEY]);
  return rows[0] || null;
}

function conflict(latest) {
  const view = toView(latest);
  return reply(409, { ok: false, conflict: true, error: `${view.updated_by} が先にこの行を更新しました`, row: view });
}

// 入力チェック。current（更新前の行）があれば、fields に無い項目は今の値を使う
export function normalizeTask(fields, current) {
  const pick = (k, fallback) => (fields[k] === undefined ? (current ? current[k] : fallback) : fields[k]);
  const title = str(pick('title', ''));
  const owner = str(pick('owner', ''));
  const note = str(pick('note', ''), true);
  const dueRaw = pick('due_date', null);
  const status = String(pick('status', 'todo'));

  if (!title) return { error: 'やることを入力してください' };
  if (len(title) > 100) return { error: 'やることは100字以内で入力してください' };
  if (len(owner) > 50) return { error: '担当は50字以内で入力してください' };
  if (len(note) > 1000) return { error: 'メモは1000字以内で入力してください' };
  if (!STATUSES.includes(status)) return { error: '状態が不正です' };
  const due = dueRaw === null || dueRaw === '' ? null : String(dueRaw);
  if (due !== null && !isValidDate(due)) return { error: '期日の形式が不正です' };
  return { value: { title, owner, note, due_date: due, status } };
}

export function normalizeSchedule(fields, current) {
  const pick = (k, fallback) => (fields[k] === undefined ? (current ? current[k] : fallback) : fields[k]);
  const title = str(pick('title', ''));
  const owner = str(pick('owner', ''));
  const place = str(pick('place', ''));
  const note = str(pick('note', ''), true);
  const start = str(pick('start_time', ''));
  const endRaw = pick('end_time', null);
  const end = endRaw === null || endRaw === '' ? null : str(endRaw);

  if (!start) return { error: '開始時刻を入力してください' };
  if (!TIME_RE.test(start)) return { error: '開始時刻は 00:00 の形で入力してください' };
  if (end !== null && !TIME_RE.test(end)) return { error: '終了時刻は 00:00 の形で入力してください' };
  if (end !== null && end < start) return { error: '終了時刻は開始時刻より後にしてください' };
  if (!title) return { error: '内容を入力してください' };
  if (len(title) > 100) return { error: '内容は100字以内で入力してください' };
  if (len(owner) > 50) return { error: '担当は50字以内で入力してください' };
  if (len(place) > 50) return { error: '場所は50字以内で入力してください' };
  if (len(note) > 1000) return { error: 'メモは1000字以内で入力してください' };
  return { value: { title, owner, place, note, start_time: start, end_time: end } };
}

// 一行の項目は前後の空白を落とす。メモは改行を残し、前後の空白行だけ落とす
function str(v, multiline = false) {
  const s = String(v ?? '');
  return multiline ? s.replace(/\r\n/g, '\n').replace(/^\s*\n|\s+$/g, '') : s.replace(/\s+/g, ' ').trim();
}

// DB の char_length と同じく、サロゲートペアを1字と数える
function len(s) {
  return [...s].length;
}

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function sameInstant(dbValue, expected) {
  if (!expected) return false;
  const t = Date.parse(String(expected));
  return !Number.isNaN(t) && toDate(dbValue).getTime() === t;
}

function toDate(v) {
  return v instanceof Date ? v : new Date(v);
}

function toView(row) {
  return { ...row, updated_at: toDate(row.updated_at).toISOString() };
}

function reply(status, body) {
  return { status, body };
}
