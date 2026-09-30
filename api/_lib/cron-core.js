// Cron 再送の本体（D8）。api/cron-notify.js から呼ぶ。
import { isGasConfigured } from './gas.js';
import { deliverNotification, findPendingForCron, CRON_ACTOR } from './notify.js';

export async function runCron(ctx, sql) {
  // GAS の設定が無い環境（プレビュー等）では何もしない。行は未通知のまま残す
  if (!isGasConfigured(ctx.env)) return { skipped: true, reason: 'gas_not_configured', processed: 0 };

  const rows = await findPendingForCron(sql);
  const results = [];
  for (const row of rows) {
    try {
      const n = await deliverNotification(ctx, sql, row, { changedBy: CRON_ACTOR, recordHistory: true });
      results.push({ id: row.id, mailSent: n.mailSent, slackSent: n.slackSent, error: n.error });
    } catch (err) {
      results.push({ id: row.id, error: String(err && err.message || err) });
    }
  }
  return { processed: rows.length, results };
}
