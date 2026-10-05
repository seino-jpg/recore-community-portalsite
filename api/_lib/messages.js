// メール・Slack の文面（D5）。GAS の Mail.js・Slack.js の文面をそのまま移した。
// 入力は toRecord() で揃えた1件（申込行＋イベント表示値＋受付日時の JST 表示）。
import { formatJst } from './db.js';

export const SENDER_NAME = 'RECOREコミュニティ事務局';
export const SITE_URL = 'https://recore-community-portalsite.vercel.app/';
export const ADMIN_URL = 'https://recore-community-portalsite.vercel.app/admin';

const LINE = '────────────────────────';

/**
 * 申込行（toApplicationView の形）とイベント表示値を文面用の1件にする。
 * 参加人数は氏名配列の長さ。受付日時は JST の表示文字列にする。
 */
export function toRecord(app, event) {
  app = app || {};
  event = event || {};
  const attendees = (Array.isArray(app.attendees) ? app.attendees : [])
    .map((v) => String(v || '').trim()).filter(Boolean);
  return {
    company: String(app.company || '').trim(),
    name: String(app.representative_name || '').trim(),
    role: String(app.role || '').trim(),
    email: String(app.email || '').trim(),
    tel: String(app.tel || '').trim(),
    attendeeCount: attendees.length,
    attendees,
    carCount: parseInt(app.car_count, 10),
    message: String(app.message || '').trim(),
    event: String(event.name || app.event_name || '（イベント名なし）').trim(),
    eventDate: String(event.date_text || '').trim(),
    eventPlace: String(event.place || '').trim(),
    eventDetail: String(event.detail || '').trim(),
    receivedAtText: app.received_at ? formatJst(app.received_at) : '',
    receivedAtShortText: app.received_at ? formatJst(app.received_at, false) : ''
  };
}

function formatAttendees(record) {
  return record.attendees.join('、');
}

function formatCarCount(record) {
  if (!(record.carCount >= 0)) return '未回答';
  return record.carCount === 0 ? '0台（公共交通機関）' : record.carCount + '台';
}

/** 申込者への確認メール。署名のアドレスは送信元（返信先）にする（D4） */
export function confirmationMail(record, fromAddress) {
  const body = [];
  body.push(record.company);
  body.push(record.name + ' 様');
  body.push('');
  body.push('この度は RECOREコミュニティイベントへお申し込みいただき、ありがとうございます。');
  body.push('以下の内容で受け付けました。');
  body.push('');
  body.push(LINE);
  body.push('【イベント】');
  body.push(record.event);
  if (record.eventDate) {
    body.push('');
    body.push('【開催日時】');
    body.push(record.eventDate);
  }
  if (record.eventPlace) {
    body.push('');
    body.push('【開催場所】');
    record.eventPlace.split('\n').forEach((l) => body.push(l));
  }
  if (record.eventDetail) {
    body.push('');
    body.push('【内容】');
    record.eventDetail.split('\n').forEach((l) => body.push(l));
  }
  body.push(LINE);
  body.push('');
  body.push('【お申し込み内容】');
  body.push('会社名：' + record.company);
  body.push('代表者：' + record.name);
  body.push('役職：' + (record.role || '未回答'));
  body.push('メールアドレス：' + record.email);
  body.push('電話番号：' + record.tel);
  body.push('参加人数：' + record.attendeeCount + '名');
  body.push('参加者：' + formatAttendees(record));
  body.push('お車の台数：' + formatCarCount(record));
  if (record.message) {
    body.push('ご質問・ご要望：' + record.message);
  }
  body.push('');
  body.push('ご不明な点がございましたら、本メールにご返信ください。');
  body.push('');
  body.push(LINE);
  body.push(SENDER_NAME);
  body.push(fromAddress);
  body.push(SITE_URL);
  return {
    subject: '【RECOREコミュニティ】お申し込みを受け付けました',
    body: body.join('\n')
  };
}

/** 運営宛の申込通知メール（Slack が使えないときのフォールバック） */
export function operatorApplicationMail(record, reason) {
  const body = [
    'ポータルサイトからイベント参加の申し込みがありました。',
    reason ? '※ ' + reason : null,
    '',
    '受付日時：' + record.receivedAtText,
    'イベント：' + record.event,
    '会社名：' + record.company,
    '代表者：' + record.name,
    '役職：' + (record.role || '未回答'),
    'メールアドレス：' + record.email,
    '電話番号：' + record.tel,
    '参加人数：' + record.attendeeCount + '名',
    '参加者：' + formatAttendees(record),
    'お車の台数：' + formatCarCount(record),
    'ご質問・ご要望：' + (record.message || 'なし'),
    '',
    '申し込み一覧：',
    ADMIN_URL
  ].filter((l) => l !== null).join('\n');
  return {
    subject: '【申し込み】' + record.company + ' ' + record.name + ' 様｜' + record.event,
    body
  };
}

/** 運営宛の任意文面メール（取消・変更の通知で Slack が使えないとき） */
export function operatorTextMail(subject, text, reason) {
  return { subject, body: (reason ? '※ ' + reason + '\n\n' : '') + text };
}

/** 申込の Slack 文面。notes は「※ …」の行として足す */
export function applicationSlackText(record, notes) {
  const lines = [
    '*【イベント申し込み】* ' + record.event,
    '',
    '*会社名：* ' + record.company,
    '*代表者：* ' + record.name + '（' + (record.role || '役職未回答') + '）',
    '*メールアドレス：* ' + record.email,
    '*電話番号：* ' + record.tel,
    '*参加人数：* ' + record.attendeeCount + '名（' + formatAttendees(record) + '）',
    '*お車の台数：* ' + formatCarCount(record),
    '*ご質問・ご要望：* ' + (record.message || 'なし'),
    '*受付日時：* ' + record.receivedAtShortText
  ];
  (notes || []).forEach((n) => lines.push('※ ' + n));
  lines.push('');
  lines.push('<' + ADMIN_URL + '|申し込み一覧を開く>');
  return lines.join('\n');
}

/** 取消・変更の Slack 文面。変更は after にある項目だけを「前 → 後」で並べる */
export function changeSlackText(type, record, changedBy, before, after) {
  const lines = [
    (type === 'cancel' ? '*【申込取消】* ' : '*【申込変更】* ') + record.event,
    '',
    '*会社名：* ' + record.company,
    '*代表者：* ' + record.name + '（' + (record.role || '役職未回答') + '）',
    '*メールアドレス：* ' + record.email,
    '*電話番号：* ' + record.tel
  ];
  if (type === 'update') {
    before = before || {};
    after = after || {};
    Object.keys(after).forEach((k) => {
      lines.push('*' + changeLabel(k) + '：* ' + changeValue(k, before[k]) + ' → ' + changeValue(k, after[k]));
    });
  } else {
    lines.push('*参加人数：* ' + record.attendeeCount + '名（' + formatAttendees(record) + '）');
    lines.push('*お車の台数：* ' + formatCarCount(record));
  }
  lines.push('*操作者：* ' + String(changedBy || ''));
  lines.push('');
  lines.push('<' + ADMIN_URL + '|申し込み一覧を開く>');
  return lines.join('\n');
}

export function changeSubject(type, record) {
  return (type === 'cancel' ? '【申込取消】' : '【申込変更】') + record.company + ' ' + record.name + ' 様｜' + record.event;
}

function changeLabel(key) {
  return { attendees: '参加者', car_count: 'お車の台数', message: 'ご質問・ご要望' }[key] || key;
}

function changeValue(key, v) {
  if (key === 'attendees') {
    const list = Array.isArray(v) ? v : [];
    return list.length + '名（' + list.join('、') + '）';
  }
  if (key === 'car_count') return formatCarCount({ carCount: parseInt(v, 10) });
  return v ? String(v) : 'なし';
}
