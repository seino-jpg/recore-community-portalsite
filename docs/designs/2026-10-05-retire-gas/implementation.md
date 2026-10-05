# 申込の GAS とスプレッドシートを廃止する：実装記録

状態: 実装中
設計書: design.md（確定 2026-10-05）
更新: 2026-10-05

## 既存の確認

| リポジトリ | 同じ機能のブランチ・PR | 似た処理 |
|---|---|---|
| seino-jpg/recore-community-portalsite | PR #8（`feature/applications-db`）・PR #9（`feature/applications-db-front`）だけ。どちらも未マージで、この変更は PR #8 に積む | `api/_lib/gas.js`（GAS への通知要求）を置き換える。戻り値の形（`{ sent, mail, slack }`）は `notify.js`・`admin-core.js` がそのまま使えるように保つ |
| ~/gas-community-form | — | `Mail.js`・`Slack.js` の文面と Slack→メールの切替をサイト側に移す（D5「文面は今と同じ」） |

## 手本にする実装

| 層 | ファイル | 理由 |
|---|---|---|
| 外部 API 呼び出し | `api/_lib/gas.js` | 設定が無ければ `not_configured` で送らない（D9）・`fetchWithTimeout`・例外を戻り値に畳む流儀 |
| Google の OAuth | `scripts/_sheet.mjs` の `accessToken` | リフレッシュトークンからアクセストークンを取る同じ手順 |
| 文面 | `~/gas-community-form/Mail.js`・`Slack.js` | 行ごとにそのまま移す |
| テスト | `test/helpers.mjs` の `mockFetch` | URL で振り分けるモックに Gmail・Slack・トークンの行き先を足す |

## 作業手順

| # | リポジトリ | ファイル | 変更 | つながるアウトプット・ユースケース |
|---|---|---|---|---|
| 1 | portal | `api/_lib/messages.js`（新規） | 確認メール・運営宛メール・Slack（申込・取消・変更）の文面。GAS の文面を移す。署名のアドレスは送信元（community@）にする | D4・D5／U1・U3・U6 |
| 2 | portal | `api/_lib/gmail.js`（新規） | リフレッシュトークン→アクセストークン、UTF-8 の MIME（件名・差出人名は encoded-word、本文は base64）、Gmail API で送信。`invalid_grant` は「認証切れ」と区別して返す | D2・D3・D6／U1・U4・U5・U10 |
| 3 | portal | `api/_lib/slack.js`（新規） | chat.postMessage | D5／U1・U3 |
| 4 | portal | `api/_lib/notifier.js`（新規）・`api/_lib/gas.js`（削除） | 申込通知（メール→Slack、Slack 失敗時は運営宛メール、認証切れなら Slack に注記）と変更通知。設定が欠けていれば送らない。戻り値は gas.js と同じ形 | D1・D4・D5・D6・D9／U1・U3〜U6・U9 |
| 5 | portal | `api/_lib/notify.js`・`admin-core.js`・`cron-core.js` | 呼び先を notifier.js に替える | D1／U4・U6・U9 |
| 6 | portal | `api/_lib/apply-core.js` | GAS からの転送（`source=gas_forward`）の受付を消す | D7／U7・U12 |
| 7 | portal | `api/_lib/events.js`・`db.js`・`http.js`・`auth.js`・`validate.js` のコメント | 「GAS に渡す」等の説明を今の実態に直す（コメントだけ） | U12 |
| 8 | portal | `test/helpers.mjs`・`apply`・`admin`・`cron` の各テスト、`test/gas.test.mjs`（削除）、`test/notifier.test.mjs`（新規） | GAS のモックを Gmail・Slack・トークンのモックに替え、ユースケースを確かめる | 全ユースケース |

DB（`db/schema.sql`）は変えない（設計「DB は変えない」）。`source` の `gas_forward` は使われなくなるが、制約から外すとスキーマ変更になるので残す。

## 検証

| # | ユースケース | 結果 | 確かめ方 |
|---|---|---|---|

## デプロイ時の作業・マージ順

（検証のあとに書く）

## レビューからの戻り

| 日付 | 指摘 | 対応 |
|---|---|---|
