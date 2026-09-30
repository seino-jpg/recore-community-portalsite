// /admin の認証（D12・D13）。GAS の authenticateAdmin と同じ検証項目を落とさずに移す。
//
// 環境変数（本番にだけ置く・D19）:
//   GOOGLE_CLIENT_ID    : OAuth 2.0 クライアント ID（aud の照合先。今の admin.html と同じ値）
//   ADMIN_EMAILS        : 閲覧を許可するメール（カンマ区切り）
//   ADMIN_EDITOR_EMAILS : 取消・変更・再送を許可するメール（カンマ区切り。閲覧の許可リストとは別に照合）
// どれかが未設定なら誰も通さない（設定漏れを「全員許可」にしない）。

const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export function parseEmailList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * ID トークンを検証し、閲覧の許可リストと照合する。
 * 戻り値: { ok: true, email, canEdit } または { ok: false, error }
 *
 * 弾く順序（早いものから）:
 *   1. idToken が無い
 *   2. GOOGLE_CLIENT_ID / ADMIN_EMAILS が未設定
 *   3. tokeninfo が 200 以外（期限切れ・改ざん・形式不正）
 *   4. iss が Google でない
 *   5. aud がこのクライアント ID と一致しない（別サイト向けのトークン）
 *   6. exp を過ぎている
 *   7. email_verified が true でない
 *   8. email が許可リストに無い
 */
export async function authenticateAdmin(idToken, ctx) {
  if (!idToken || typeof idToken !== 'string') {
    return { ok: false, error: 'ログインが必要です' };
  }

  const clientId = String(ctx.env.GOOGLE_CLIENT_ID || '').trim();
  const allowed = parseEmailList(ctx.env.ADMIN_EMAILS);
  const editors = parseEmailList(ctx.env.ADMIN_EDITOR_EMAILS);
  if (!clientId || allowed.length === 0) {
    return { ok: false, error: '管理画面の設定が完了していません（GOOGLE_CLIENT_ID / ADMIN_EMAILS）' };
  }

  const info = await fetchTokenInfo(idToken, ctx.fetch);
  if (!info) {
    return { ok: false, error: 'ログイン情報を確認できませんでした。再度ログインしてください' };
  }
  if (!VALID_ISSUERS.includes(String(info.iss || ''))) {
    return { ok: false, error: 'ログイン情報の発行元が不正です' };
  }
  if (String(info.aud || '') !== clientId) {
    return { ok: false, error: 'ログイン情報の宛先が不正です' };
  }
  const exp = parseInt(info.exp, 10);
  if (!(exp > Math.floor(ctx.now() / 1000))) {
    return { ok: false, error: 'ログインの有効期限が切れています。再度ログインしてください' };
  }
  // tokeninfo は真偽値を文字列 "true" で返す
  if (String(info.email_verified) !== 'true') {
    return { ok: false, error: 'メールアドレスが確認済みのアカウントでログインしてください' };
  }

  const email = String(info.email || '').trim().toLowerCase();
  if (!email || !allowed.includes(email)) {
    return { ok: false, error: 'このアカウントには閲覧権限がありません' };
  }
  return { ok: true, email, canEdit: editors.includes(email) };
}

async function fetchTokenInfo(idToken, fetchFn) {
  try {
    const res = await fetchFn(TOKENINFO_ENDPOINT + encodeURIComponent(idToken));
    if (res.status !== 200) return null;
    return await res.json();
  } catch {
    return null;
  }
}
