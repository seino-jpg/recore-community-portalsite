// 申込シート（Google Sheets）を読み取り専用で読む。書き込みはしない。
// 認証は gspread の authorized_user.json（refresh_token）を使い、Sheets API v4 を直接呼ぶ。
//
// 環境変数:
//   SPREADSHEET_ID              : 申込シートの ID（コードに固定しない）
//   SHEET_TAB                   : 読むタブ名（既定 '【関東】vol.4'）
//   GOOGLE_AUTHORIZED_USER_FILE : 既定 ~/.config/gspread/authorized_user.json
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export const DEFAULT_TAB = '【関東】vol.4';
const HEADERS = ['受付日時', 'イベント', '会社名', '代表者氏名', '役職', 'メールアドレス', '電話番号', '参加人数', '参加者氏名', '車の台数', 'ご質問・ご要望'];

export function sheetConfig(env = process.env) {
  if (!env.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID を指定してください');
  return {
    spreadsheetId: env.SPREADSHEET_ID,
    tab: env.SHEET_TAB || DEFAULT_TAB,
    authFile: env.GOOGLE_AUTHORIZED_USER_FILE || `${homedir()}/.config/gspread/authorized_user.json`
  };
}

async function accessToken(authFile) {
  const cred = JSON.parse(readFileSync(authFile, 'utf8'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.client_id,
      client_secret: cred.client_secret,
      refresh_token: cred.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) throw new Error('トークン更新に失敗: HTTP ' + res.status);
  return (await res.json()).access_token;
}

/**
 * タブの全行を「シートに表示されている文字列」で読み、ヘッダー名→値のオブジェクトにする。
 * 空行は除く。ヘッダーが想定と違えば止める。
 */
export async function readSheetRows(cfg) {
  const token = await accessToken(cfg.authFile);
  const range = encodeURIComponent(`'${cfg.tab}'!A1:K`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('シート読み取りに失敗: HTTP ' + res.status + ' ' + (await res.text()));
  const values = (await res.json()).values || [];
  if (values.length === 0) return [];
  const header = values[0].map((h) => String(h || '').trim());
  if (JSON.stringify(header) !== JSON.stringify(HEADERS)) {
    throw new Error('ヘッダーが想定と違います: ' + JSON.stringify(header));
  }
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r || r.every((v) => String(v ?? '').trim() === '')) continue;
    const obj = {};
    HEADERS.forEach((h, j) => { obj[h] = r[j] == null ? '' : String(r[j]); });
    obj._rowNumber = i + 1;
    rows.push(obj);
  }
  return rows;
}

// 'yyyy/M/d H:mm:ss'（JST）→ UTC の ISO 文字列
export function jstTextToIso(text) {
  const m = String(text).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error('受付日時を解釈できません: ' + text);
  const [, y, mo, d, h, mi, s] = m;
  const pad = (v) => String(v).padStart(2, '0');
  return new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:${s || '00'}+09:00`).toISOString();
}

// シート1行を DB の申込行の形にする（電話番号は表示文字列の原文のまま）
export function sheetRowToApplication(row, eventKey) {
  const attendees = String(row['参加者氏名'] || '').split(/[\n、,]/).map((v) => v.trim()).filter(Boolean);
  const count = parseInt(row['参加人数'], 10);
  if (attendees.length !== count) {
    throw new Error(`行 ${row._rowNumber}: 参加人数 ${count} と参加者氏名の数 ${attendees.length} が一致しません`);
  }
  const carCount = parseInt(row['車の台数'], 10);
  if (!(carCount >= 0 && carCount <= 5)) throw new Error(`行 ${row._rowNumber}: 車の台数を解釈できません`);
  const receivedAt = jstTextToIso(row['受付日時']);
  const app = {
    event_key: eventKey,
    event_name: row['イベント'].trim(),
    company: row['会社名'].trim(),
    representative_name: row['代表者氏名'].trim(),
    role: row['役職'].trim(),
    email: row['メールアドレス'].trim(),
    tel: row['電話番号'].trim(),
    attendees,
    car_count: carCount,
    message: row['ご質問・ご要望'].trim(),
    received_at: receivedAt
  };
  // 何度実行しても同じトークンになるよう、行の内容から決める（UUID v5 相当の形）
  app.submission_token = deterministicUuid(['sheet_import', eventKey, receivedAt, app.email, app.company, app.tel].join('\u0000'));
  return app;
}

function deterministicUuid(input) {
  const h = createHash('sha256').update(input).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
