# 申込の GAS とスプレッドシートを廃止する：実装記録

状態: 検証済み
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

実装中に決めたこと（設計の範囲内）：

- 通知の設定（Gmail 4つ・Slack 2つ・`OPERATOR_EMAILS`）が1つでも欠けていれば送らない（D9）。GAS にあった「Slack トークンが無ければメールに切り替える」は、設定を Vercel にまとめて入れるので持ち込まない
- 認証切れの注記（D6）は申込時の Slack 通知に添える。申込の最初の試行では必ず Slack も送るので、Cron の再試行で注記を繰り返さない
- Slack からメールに切り替えたときも、理由を `notify_last_error` に残す（設計 U3「失敗内容が残る」）。/admin の未通知件数は送信日時で数えるので、この記録では増えない
- 申込 HTTP のテストは、関東 Vol.4 の締切（9/30）を過ぎて実行日によって落ちるようになったため、関西 Vol.2 で送るように直した

## 検証

実施日 2026-10-05。DB は検証用（Development の DATABASE_URL）、Google（OAuth・Gmail）と Slack は fetch のモック。送られたメールは MIME を復号して、件名・宛先・本文で確かめた。`npm test` 40 件すべて通過（`test/apply`・`admin`・`cron`・`notifier`）。

| # | ユースケース | 結果 | 確かめ方 |
|---|---|---|---|
| U1 | 通常の申込 | 通った | apply.test「U1」: DB に1行・送信日時2つ・メール1通（差出人「RECOREコミュニティ事務局 <community@…>」・返信先 community@・件名）・Slack 1件（チャンネル・Bot トークン）。notifier.test「新 U1」: メール本文と Slack 文面の全文が GAS と一致（署名のアドレスだけ送信元） |
| U2 | 申込者が返信 | 切替時に本番で確認 | 返信先が community@ になることは U1 で確認済み。転送（清野さん・上田さん）は community@ の Gmail 設定なので、切替①で設定し、本番のテスト申込に返信して確かめる |
| U3 | Slack だけ失敗 | 通った | apply.test「新 U3」: 運営2名に直接1通（community@ を経由しない）・件名と本文が GAS と同じ・`slack_sent_at` が入り、切り替えた理由が残る。Slack もメールも失敗したら `slack_sent_at` は空のまま、両方の失敗が残る。cron.test: 再送で申込者へのメールを二重に送らない |
| U4 | Gmail が一時的に失敗 | 通った | apply.test「新 U4」: 例外・HTTP 500・429 でも保存は成功・mailSent=false・失敗内容あり。Slack に認証切れの注記は出ない。cron.test「U8」: 復旧後の Cron で届き、メールは1通だけ。admin.test「U10」: 再送ボタンで届き、未通知が 1→0 |
| U5 | メールの認証切れ | 通った | apply.test「新 U5」: invalid_grant でも保存は成功・Gmail を呼ばない・Slack に「※ 確認メールを送れていません（メール送信の認証が切れています）」。cron.test「新 U5」: 再試行では注記を繰り返さず、トークンを入れ替えると Cron で届く。notifier.test: Gmail の 401 も認証切れとして扱い、次はトークンを取り直す |
| U6 | 取消・変更 | 通った | admin.test「U16・U17」: Slack 1件だけ・申込者へのメールなし・取消は全文一致、変更は変えた項目だけ「前 → 後」。notifier.test「新 U6」: Slack が失敗したら運営宛メール（件名・本文は GAS と同じ） |
| U7 | 古いタブから申込 | 通った（API 側） | apply.test「新 U7・U12」: GAS 形式の転送（token 無し）は 400 で保存しない。旧 HTML の送信先は GAS なので、デプロイをアーカイブしたあとは既存の失敗表示になる（切替⑤で確認） |
| U8 | 切替中にシートへ新着 | 切替時に確認 | 運用の手順（切替⑥でシートの行数を確認し直す）。取り込みスクリプトは変えていない（何度流しても二重にならないことは旧設計 U20 で確認済み） |
| U9 | プレビュー | 通った | apply.test「U26（新 U9）」: 設定なし・Slack だけ・Gmail だけのどれでも送らず、試行回数も増えない。cron.test: 設定なしなら skipped |
| U10 | 日本語・記号 | 通った | notifier.test「新 U10」: ㈱①Ⅲ・全角英字・“”・絵文字・𠮷・80字を超える会社名で、件名・本文・差出人名が化けない。encoded-word は1語75字以内、ヘッダーの1行は998字未満。件名・宛先に改行を入れても Bcc ヘッダーは作られない |
| U11 | 移行の一致 | 切替時に確認 | 取り込み・突き合わせのスクリプトは変えていない（旧設計 U20 で確認済み）。本番では切替④で行う |
| U12 | GAS が残っていない | 通った（コード）・切替時に確認（本番） | `api/` に GAS の呼び出しが無い（`gas.js` 削除・grep で0件）。3つの関数が読み込める。PR #9 の画面も GAS を呼ばない。デプロイのアーカイブと `GAS_URL`・`GAS_SHARED_SECRET` の削除は切替⑤・② |

## デプロイ時の作業・マージ順

| リポジトリ | ブランチ | 向き先 | マージ順 | デプロイ時の作業 |
|---|---|---|---|---|
| seino-jpg/recore-community-portalsite | `feature/applications-db`（PR #8） | main | 1 | 設計「切替の流れ」①〜④。本番の環境変数は、追加：`GMAIL_CLIENT_ID`・`GMAIL_CLIENT_SECRET`・`GMAIL_REFRESH_TOKEN`・`MAIL_FROM`（community@recore-corp.jp）・`OPERATOR_EMAILS`（清野さん・上田さん）・`SLACK_BOT_TOKEN`・`SLACK_CHANNEL_ID`・`ADMIN_EMAILS`（GAS から移す）／削除：`GAS_URL`・`GAS_SHARED_SECRET`（10/5 に入れたもの）。本番 DB のスキーマは 10/5 に適用済み |
| seino-jpg/recore-community-portalsite | `feature/applications-db-front`（PR #9） | main | 2 | PR #8 を取り込んでからマージする。直後に GAS のデプロイをアーカイブ（Apps Script の「デプロイを管理」）。そのあと切替⑥ |
| ~/gas-community-form | — | — | — | デプロイしない。master の a8322fc（送信専用版）は使わない |

旧設計 `2026-09-25-applications-db/implementation.md` の「デプロイ時の作業」のうち、手順4（GAS のスクリプトプロパティ）と手順6（GAS のデプロイ）は不要になった。

## レビューからの戻り

| 日付 | 指摘 | 対応 |
|---|---|---|
