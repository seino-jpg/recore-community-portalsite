// イベント定義の正本 events.json を読む（D4）。
// API はここから締切判定とメール・Slack の表示値を作り、クライアントが送るイベント情報は使わない。
import eventsFile from '../../events.json' with { type: 'json' };

const JST_OFFSET = '+09:00';

export function getEvent(key) {
  if (typeof key !== 'string') return null;
  const ev = Object.prototype.hasOwnProperty.call(eventsFile.events, key) ? eventsFile.events[key] : null;
  return ev ? { key, ...ev } : null;
}

export function listEvents() {
  return Object.keys(eventsFile.events).map((key) => ({ key, ...eventsFile.events[key] }));
}

// 締切日の 23:59:59 JST 以降は受け付けない。前日 23:59:59 までは受け付ける。
export function isClosed(ev, now = Date.now()) {
  return now >= Date.parse(ev.deadline + 'T23:59:59' + JST_OFFSET);
}

// メール・Slack に使うイベント表示値（申込行のイベント名は時点値なので別に持つ）
export function eventDisplay(ev) {
  return { name: ev.name, date_text: ev.date_text, place: ev.place, detail: ev.detail };
}
