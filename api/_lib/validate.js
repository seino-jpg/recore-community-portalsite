// 申込の入力検証。条件は GAS の doPost と同じ（必須項目・人数≧1・台数≧0・氏名数＝人数・メール形式）。
// 戻り値: { ok: true, record } または { ok: false, error }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// 参加者氏名を配列に揃える。配列で届けばそのまま、文字列なら区切り文字で分ける。空要素は除く。
export function normalizeAttendees(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\n、,]/);
  return list.map((v) => String(v ?? '').trim()).filter(Boolean);
}

export function validateApplication(data) {
  const d = data && typeof data === 'object' ? data : {};
  const record = {
    company: str(d.company),
    name: str(d.name),
    role: str(d.role),
    email: str(d.email),
    tel: str(d.tel),
    attendeeCount: parseInt(d.attendeeCount, 10),
    attendees: normalizeAttendees(d.attendees),
    carCount: parseInt(d.carCount, 10),
    message: str(d.message)
  };

  if (!record.company || !record.name || !record.role || !record.email || !record.tel) {
    return { ok: false, error: '必須項目が入力されていません' };
  }
  if (!(record.attendeeCount >= 1)) {
    return { ok: false, error: '参加人数が入力されていません' };
  }
  if (!(record.carCount >= 0)) {
    return { ok: false, error: 'お車の台数が入力されていません' };
  }
  if (record.carCount > 5) {
    return { ok: false, error: 'お車の台数は5台までです' };
  }
  if (record.attendees.length !== record.attendeeCount) {
    return { ok: false, error: '参加人数と参加者氏名の数が一致しません' };
  }
  if (!EMAIL_RE.test(record.email)) {
    return { ok: false, error: 'メールアドレスの形式が不正です' };
  }
  return { ok: true, record };
}

function str(v) {
  return String(v ?? '').trim();
}

// 参加者の区分（attendee-category D21）。フォームからの申込は general
export const CATEGORIES = ['general', 'recore', 'vendor', 'staff'];
export const RECORE_COMPANY = '株式会社RECORE';

/**
 * /admin からの運営登録の入力検証（D24）。区分・会社名・参加者氏名・台数・メモだけを受ける。
 * 区分が RECORE で会社名が空なら「株式会社RECORE」を入れる。代表者は氏名の先頭。
 * 戻り値: { ok: true, record } または { ok: false, error }
 */
export function validateRegistration(data) {
  const d = data && typeof data === 'object' ? data : {};
  const category = str(d.category);
  const record = {
    category,
    company: str(d.company) || (category === 'recore' ? RECORE_COMPANY : ''),
    attendees: normalizeAttendees(d.attendees),
    carCount: parseInt(d.carCount, 10),
    message: str(d.message)
  };

  if (!CATEGORIES.includes(category)) {
    return { ok: false, error: '区分を選んでください' };
  }
  if (!record.company) {
    return { ok: false, error: '会社名を入力してください' };
  }
  if (record.attendees.length < 1) {
    return { ok: false, error: '参加者氏名を1名以上入力してください' };
  }
  if (!(record.carCount >= 0 && record.carCount <= 5)) {
    return { ok: false, error: 'お車の台数は0〜5台で入力してください' };
  }
  return { ok: true, record };
}
