# 申込データの正本をサイト側 DB に移す：実装記録

設計書: design.md（確定 2026-09-26）

## 既存の確認

| リポジトリ | 同じ機能のブランチ・PR | 似た処理 |
|---|---|---|
| recore-community-portalsite | なし（2026-09-26 確認。ブランチは main・fix/remove-floor-guide・photos-kanto-vol4、PR #1〜#7 に API・DB なし） | なし。サーバー処理は1つも無い静的サイト |
| gas-community-form（remote なし・正本は GAS） | —（2026-09-25 に GAS 実体とローカルの一致を確認済み） | 申込受付・検証・メール・Slack・/admin 認証の現行実装。API はこれを写して作る |

## 手本にする実装

| 層 | ファイル | 理由 |
|---|---|---|
| 入力検証 | GAS `Code.js` の `doPost`（必須項目・人数≧1・台数≧0・氏名数＝人数・メール形式） | 今の受付条件をそのまま API に移す。条件を変えない |
| /admin 認証 | GAS `Admin.js` の `authenticateAdmin`（tokeninfo で iss / aud / exp / email_verified → 許可リスト） | 検証項目を1つも落とさずに API に移す（D12） |
| 通知の文面 | GAS `Mail.js`・`Slack.js` | 文面・差出人を変えない（清野さんの判断3）。GAS に残して入力元だけ API に替える |
| 画面 | `admin.html`（GIS ログイン・`render`／`summarize`／`renderTable`）、`apply.html`（`EVENTS`・送信処理） | 見た目と流儀は既存に合わせ、送信先とデータの出どころだけ替える |
| API | 前例なし。Vercel Functions（Node.js・フレームワークなし）の `api/` 直下に置く | サイトはビルドなしの静的配信。フレームワークを入れない |

## 作業手順

設計 D17 の切替順序を守るため **PR を2つに分ける**。PR-A は画面を変えず（マージしても申込の流れは変わらない）、PR-B は突き合わせ（D18）が一致してから出す。

| # | リポジトリ | ファイル | 変更 | つながるアウトプット・ユースケース |
|---|---|---|---|---|
| 1 | portal（PR-A） | `package.json` | Neon のドライバだけを依存に足す | D1 |
| 2 | portal（PR-A） | `db/schema.sql` | applications・application_changes の2表（設計のデータ定義どおり。submission_token 一意・tel は文字列・attendees は配列・status・通知状態） | D2・D3・D5・D6・D7・D9 |
| 3 | portal（PR-A） | `events.json` | イベント定義の正本（今の `apply.html` の `EVENTS`・`admin.html` の `EVENT_CAPACITY`・LP の締切を1か所に） | D4 |
| 4 | portal（PR-A） | `api/_lib/`（DB 接続・ID トークン検証・GAS 送信・入力検証） | 共通処理。編集の許可リスト照合を含む | D10・D12・D13・D19 |
| 5 | portal（PR-A） | `api/apply.js` | 申込受付（締切判定・検証・冪等保存・GAS 送信・通知状態の更新）。GAS からの転送（共有シークレット付き）も受ける | D4・D7・D9・D11／U1〜U13・U21 |
| 6 | portal（PR-A） | `api/admin.js` | 一覧・集計（有効行のみ）・通知未完了件数・取消・変更・再送。書き込みは編集の許可リストだけ | D5・D6・D8・D12〜D14／U14〜U18b |
| 7 | portal（PR-A） | `api/cron-notify.js`・`vercel.json` の crons | 未通知の行を10分おきに再送（最大6回）。Vercel の Cron 認証を確かめる | D8／U8・U10 |
| 8 | portal（PR-A） | `scripts/import-sheet.mjs`・`scripts/verify-import.mjs` | シート→DB の取り込み（通知済み・受付日時 JST→UTC・関西テスト除外）と D18 の突き合わせ | D16・D18／U20・U22 |
| 9 | GAS | `Code.js`・`Mail.js`・`Slack.js` | 秘密付きの送信要求（申込通知・変更通知）を受ける／action なしの申込は API へ転送しシートに書かない／旧 /admin の一覧要求には「移転しました」／Slack のリンクを /admin に | D10・D11・D14・D15／U9・U12・U13・U25 |
| 10 | portal（PR-B） | `apply.html` | イベント定義を `events.json` から読む・送信先を API に・submission_token・「確認メールは追って」の表示 | D4・D7・D9／U1・U3・U5・U8 |
| 11 | portal（PR-B） | `admin.html` | 送信先を API に・取消行を薄く表示・通知未完了件数・清野さんにだけ取消／変更／再送の操作 | D5・D8・D13／U14〜U18b |
| 12 | portal（PR-B） | `kanto-vol4.html` | 締切を `events.json` から読む | D4 |

実装の清野の解釈（設計の範囲内）: 「再送」は DB に書く操作なので D13 の編集の許可リストで照合する。

実装の清野の解釈（設計の範囲内）: D19 の「プレビュー用ブランチ」は、Neon のブランチが本番データの写しになるため使わない。プレビューは検証用 DB（本番データなし）につなぐ。目的（本番の DB と GAS に触れない）は同じ。

## デプロイ時の作業（順番どおり）

| 順 | 作業 | 誰が |
|---|---|---|
| 1 | Neon を Vercel Marketplace から追加 | **済（9/30）**。本番用 DB（Production のみ）と検証用 DB（Development・Preview）の2つ。リージョン sin1 |
| 2 | スキーマを本番 DB に適用 | Claude |
| 3 | Vercel 環境変数（本番のみ）: GAS の URL・共有シークレット・OAuth クライアント ID・閲覧／編集の許可リスト・Cron の秘密 | Claude（CLI） |
| 4 | GAS スクリプトプロパティに共有シークレットとサイト API の URL を入れる | **清野さん**（値はクリップボードに用意する） |
| 5 | PR-A をマージ → 本番に API が出る（画面は変わらない） | 清野さんの了承後 |
| 6 | GAS をデプロイ（#9）→ この時点でシートへの書き込みが止まり、申込は DB に入る（D17 ②） | Claude |
| 7 | 取り込み → 突き合わせ（D17 ③④）。1件でも違えば止める | Claude |
| 8 | PR-B をマージ（D17 ⑤）→ 本番でテスト申込→取消（運営 Slack に事前に一言） | 清野さん |
| 9 | シートのタブを保護（D17 ⑥） | Claude |

## 検証

（実装後に全ユースケースを埋める）

| # | ユースケース | 結果 | 確かめ方 |
|---|---|---|---|

## PR
