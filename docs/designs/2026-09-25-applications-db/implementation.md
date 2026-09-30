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

## 作業手順（実施済み・実ファイル名）

設計 D17 の切替順序を守るため **PR を2つに分ける**。PR-A は画面を変えず（マージしても申込の流れは変わらない）、PR-B は突き合わせ（D18）が一致してから出す。

| # | リポジトリ | ファイル | 変更 | つながるアウトプット・ユースケース |
|---|---|---|---|---|
| 1 | portal（PR-A） | `package.json`・`package-lock.json`・`.gitignore` | 依存は `@neondatabase/serverless` だけ。ESM。`npm test` は `node --test`（直列） | D1 |
| 2 | portal（PR-A） | `db/schema.sql`・`scripts/apply-schema.mjs` | applications・application_changes の2表（submission_token 一意・tel は text・attendees は text[]・status・通知状態・履歴）。適用スクリプトは `DATABASE_URL` を環境変数で受ける | D2・D3・D5・D6・D7・D9 |
| 3 | portal（PR-A） | `events.json` | イベント定義の正本（`defaultEventKey` と `events.<key>`: title・name・lead・date_text・place・detail・deadline・capacity（数値）・transportNote）。静的配信もされ、フォーム・LP が読む | D4 |
| 4 | portal（PR-A） | `api/_lib/`（`events.js` 締切判定・表示値、`db.js` 接続と JST 表示、`validate.js` 入力検証、`auth.js` tokeninfo 検証と閲覧／編集の許可リスト、`gas.js` 共有シークレット付き送信要求、`notify.js` 通知配送と状態更新、`http.js` 本文読取、`context.js` env/fetch/now の差し替え口） | 共通処理 | D10・D12・D13・D19 |
| 5 | portal（PR-A） | `api/apply.js`・`api/_lib/apply-core.js` | 申込受付（締切判定・検証・冪等保存・GAS 送信・通知状態の更新・`mailSent` で応答）。`source=gas_forward`＋共有シークレットの転送も受け、token が無ければ採番 | D4・D7・D9・D11／U1〜U13・U21 |
| 6 | portal（PR-A） | `api/admin.js`・`api/_lib/admin-core.js` | list（全イベント・有効行のみの集計・通知未完了件数）／cancel／update（attendees・car_count・message のみ・履歴は変えた項目だけ）／resend。書き込みは編集の許可リストだけ。更新と履歴は1文（CTE）で原子的に | D5・D6・D8・D12〜D14／U14〜U18b |
| 7 | portal（PR-A） | `api/cron-notify.js`・`api/_lib/cron-core.js`・`vercel.json`（`crons` 10分おき・`regions: ["sin1"]`） | 未通知の有効行を再送（最大6回）。`CRON_SECRET` の Bearer を確かめる。Pro は「1分に1回」まで可（Vercel 公式 Usage & Pricing で確認） | D8／U8・U10 |
| 8 | portal（PR-A） | `scripts/_sheet.mjs`・`scripts/import-sheet.mjs`・`scripts/verify-import.mjs` | Sheets API v4（gspread の authorized_user.json の refresh_token）で関東 Vol.4 タブを読み、DB へ（source=sheet_import・通知済み・JST→UTC・履歴 import・行内容から決めたトークンで冪等）。突き合わせは行数・全行の値・集計 | D16・D18／U20・U22 |
| 9 | GAS | `Code.js`・`Mail.js`・`Slack.js`・`Admin.js` | 秘密付きの `notify_application`／`notify_change` を受ける。action なしの申込は `SITE_API_URL` へ転送しシートに書かない。旧 /admin の `list` には「移転しました。再読み込みしてください」。Slack・メールの「申し込み一覧」リンクは /admin。シートを読む・書くコードは削除 | D10・D11・D14・D15／U9・U12・U13・U25 |
| 10 | portal（PR-B） | `apply.html` | `events.json` を読む・`/api/apply` に eventKey と入力だけ送る・`submission_token`（失敗時は同じ token で再送、成功後に更新）・`mailSent=false` なら「確認メールは追ってお送りします」・API の `code=closed` で受付終了表示 | D4・D7・D9／U1・U3・U5・U8 |
| 11 | portal（PR-B） | `admin.html` | `/api/admin` から読む・列は固定（受付日時 JST・…・状態・通知）・取消行は薄く・「通知未完了 n件」バッジ・`canEdit` の人にだけ 変更（行内編集）／取消／再送 | D5・D8・D13／U14〜U18b |
| 12 | portal（PR-B） | `kanto-vol4.html` | 締切を `events.json` から読む | D4 |

実装の清野の解釈（設計の範囲内）:

| 論点 | 解釈 |
|---|---|
| 「再送」の権限 | DB に書く操作なので D13 の編集の許可リストで照合する |
| D19 の「プレビュー用ブランチ」 | Neon のブランチは本番データの写しになるため使わない。プレビューは検証用 DB（本番データなし）につなぐ。目的（本番の DB と GAS に触れない）は同じ |
| Cron・再送の対象 | 有効行（status=active）だけ。取消した申込に「受け付けました」を送らない |
| 台数の上限 | 設計のデータ定義「整数（0〜5）」を API と DB の CHECK で守る（GAS の旧検証は ≧0 のみ。フォームは 0〜5 しか送らない） |
| 履歴 `notify` | Cron と /admin の再送で残す。申込時の初回送信は行の通知状態にだけ書く |
| GAS 送信の `send` | 未送信の分（メール／Slack）だけ頼み、再送でメールを二重に送らない |

## デプロイ時の作業（順番どおり）

| 順 | 作業 | 誰が |
|---|---|---|
| 1 | Neon を Vercel Marketplace から追加 | **済（9/30）**。本番用 DB（Production のみ）と検証用 DB（Development・Preview）の2つ。リージョン sin1 |
| 2 | スキーマを本番 DB に適用: `DATABASE_URL=<本番> node scripts/apply-schema.mjs` | Claude |
| 3 | Vercel 環境変数（**Production のみ**）: `GAS_URL`・`GAS_SHARED_SECRET`・`GOOGLE_CLIENT_ID`・`ADMIN_EMAILS`・`ADMIN_EDITOR_EMAILS`・`CRON_SECRET` | Claude（CLI） |
| 4 | GAS スクリプトプロパティ: `SITE_SHARED_SECRET`（`GAS_SHARED_SECRET` と同じ値）・`SITE_API_URL`（`https://<サイト>/api/apply`） | **清野さん**（値はクリップボードに用意する） |
| 5 | PR-A をマージ → 本番に API が出る（画面は変わらない） | 清野さんの了承後 |
| 6 | GAS をデプロイ（#9）→ この時点でシートへの書き込みが止まり、申込は DB に入る（D17 ②） | Claude |
| 7 | 取り込み → 突き合わせ（D17 ③④）: `DATABASE_URL=<本番> SPREADSHEET_ID=<ID> node scripts/import-sheet.mjs` → `node scripts/verify-import.mjs`。終了コード 1 なら止める | Claude |
| 8 | PR-B をマージ（D17 ⑤）→ 本番でテスト申込→取消（運営 Slack に事前に一言） | 清野さん |
| 9 | シートのタブを保護（D17 ⑥） | Claude |

ローカル検証の準備: `vercel env pull .env.development.local --environment=development --yes`（検証用 DB）→ `DATABASE_URL=<検証用> node scripts/apply-schema.mjs` → `npm test`。

## 検証

実施日 2026-09-30。DB は検証用（Development の DATABASE_URL）、Google tokeninfo と GAS は fetch のモック、GAS のコードは Node の vm でモックと一緒に実行、画面はモック API ＋ヘッドレス Chrome（DevTools Protocol）。テスト: `test/apply.test.mjs`・`admin.test.mjs`・`cron.test.mjs`・`gas.test.mjs`（41 件すべて通過）。

| # | ユースケース | 結果 | 確かめ方 |
|---|---|---|---|
| U1 | 通常の申込 | 通った | apply.test「U1」: DB に1行 source=site・event_name が時点値・mail_sent_at／slack_sent_at・GAS への本文にシークレット・イベント表示値・JST 受付日時。画面: モック API で成功文言「受付確認のメールをお送りしました」、送る項目が eventKey＋入力＋token だけ |
| U2 | 電話番号の保持 | 通った | apply.test「U2」: `09000000000`・`+819000000000`・`03-0000-0000` が DB と GAS 本文に原文のまま。admin.test「U14」・画面: /admin に `+819000000000`。gas.test: メール・Slack 文面に原文 |
| U3 | ボタン連打・リトライ | 通った | apply.test「U3」: 同 token 2回で DB 1行・GAS 呼び出し1回・2回目も ok（duplicate=true）。画面: 失敗後の再送は同じ token、成功後は別 token |
| U4 | 同じメールで2件目 | 通った | apply.test「U4」: 2行保存・2件目の GAS 本文 notes に「同メールで申込あり」（大小文字違いも同一視）。gas.test: Slack 文面に「※ 同メールで申込あり」 |
| U5 | 締切後の送信 | 通った | apply.test「U5」: 9/30 23:59:59 JST と 10/1 は 400・code=closed・DB 0行・GAS 未呼び出し。画面: API の closed でフォーム非表示と締切文言 |
| U6 | 締切直前 | 通った | apply.test「U6」: 9/30 23:59:00・23:59:58 JST は受け付ける |
| U7 | 未知の eventKey・不一致・形式不正 | 通った | apply.test「U7・U24」: 未知キー・空キー・人数≠氏名数・メール形式・必須欠落・人数0・台数未指定・台数6・token 不正 → 400・DB 0行 |
| U8 | GAS が応答しない | 通った | apply.test「U8」: 例外・HTTP 500 とも保存成功・mailSent=false・未通知・失敗内容。cron.test「U8」: 停止中は試行回数だけ増え、復旧後の Cron で送信日時が入り履歴 notify（cron）。admin.test「U10」: 未完了件数 1→0。画面: 「受付確認のメールは追ってお送りします」・「通知未完了 1件」バッジ |
| U9 | Slack だけ失敗 | 通った | gas.test「U9」: Slack API エラーで運営宛メールに切替・slack.ok=true・fallback=mail。apply.test「U9」: その応答で slack_sent_at が入り notify_last_error は空 |
| U10 | 再試行が6回超過 | 通った | cron.test「U10」: 10回回しても GAS 呼び出しは6回・行は未通知のまま・以後 processed=0。admin.test「U10」: 再送ボタン（API resend）で送れて履歴 notify（操作者）。画面: 未通知行にだけ「再送」 |
| U11 | DB 保存が失敗 | 通った | apply.test「U11」: 500・GAS 未呼び出し。画面: 既存の「送信に失敗しました…直接ご連絡ください」・フォームは残る |
| U12 | 旧 HTML からの送信 | 通った | gas.test「U12」: action なしの申込を SITE_API_URL に source=gas_forward＋secret で転送・SpreadsheetApp に触れない・API の応答（ok／closed）をそのまま返す。apply.test「U12・U21」: source=gas_forward で1行・token は API が採番・通知送信 |
| U13 | シークレット無しで GAS を叩く | 通った | gas.test「U13」: secret 無し・空・不一致・プロパティ未設定 → 403・メール0通。apply.test「U13」: API 側の転送受付も 403・DB 0行 |
| U14 | /admin 閲覧 | 通った | admin.test「U14」: 閲覧者に一覧・集計（有効行のみ）・関西 0件。画面: 4行表示・集計 3社/5名/残り15/1台・取消行 opacity 0.45・関西タブ 0件 |
| U15 | /admin 不正トークン | 通った | admin.test「U15」: 別 aud・期限切れ・未検証・許可外・発行元不正・無効・空 → 403・events 無し。設定漏れも 403。画面: エラー表示でデータ非表示（既存の再ログイン導線） |
| U16 | 取消 | 通った | admin.test「U16」: status=cancelled・取消日時・操作者・履歴1件（before/after）・GAS に notify_change(cancel)・残り枠 16→19・一覧に薄く残り集計外。画面: 確認ダイアログ→社数 3→2 |
| U17 | 人数変更 | 通った | admin.test「U17」: attendees 4要素・履歴に変えた項目だけ・Slack 通知・台数と要望だけの変更も可・変更なし／空／台数9 は 400。gas.test「D14」: Slack 文面に 3名→4名・1台→2台。画面: 行内編集→保存で人数 6 |
| U18 | 取消行の変更 | 通った | admin.test「U18」: 取消行の update／cancel／resend は 409・履歴増えず。画面: 取消行に操作ボタンなし |
| U18b | 清野さん以外の取消・変更 | 通った | admin.test「U18b」: 閲覧のみの運営は cancel／update／resend が 403・DB・履歴・GAS 呼び出し不変。画面: 閲覧者に「操作」列が出ない |
| U19 | 連絡先の変更 | 通った | admin.test「U19」: email・tel・company を送っても無視（変更なし＝400）。画面に入力欄なし |
| U20 | 移行の一致 | 通った（検証用 DB） | 9/30 12:5x に検証用 DB へ `import-sheet.mjs` を2回実行 → 12行・2回目は0行追加・`verify-import.mjs` が「一致: 行数・全行の値・集計」（12社・19名・5台）。`+` 始まりの電話1件も原文。移行行は通知済みで入り Cron の対象外（cron.test）。実行後に検証用 DB は消去 |
| U21 | 移行中の新着 | 通った | apply.test「U12・U21」: 転送で DB に入る（受付日時は API の now）。シートは GAS が触らない（gas.test） |
| U22 | 関西 Vol.2 | 通った | import は関東タブだけ（SHEET_TAB 既定）。admin.test「U14」・画面: 関西 0件・定員未設定 |
| U23 | 定員到達 | 通った | apply.test「U23」: 22名でも受け付ける。admin.test「U23」: remaining=-2 |
| U24 | 「その他」タブ | 通った | apply.test「U7・U24」: 未登録キーは拒否。画面: `?event=nope` は既定イベントに落ちる |
| U25 | 旧 /admin を開いたまま | 通った | gas.test「U25」: action=list に「申込一覧は移転しました。ページを再読み込みしてください。」・events 無し・SpreadsheetApp に触れない |
| U26 | プレビューのデプロイで申込 | 通った | apply.test「U26」: GAS 設定なしで保存のみ・GAS 未呼び出し・試行回数 0・転送も 403。cron.test: 設定なしは skipped。admin.test「D19」: 許可リストなしは 403 |
| — | Cron の認証・HTTP | 通った | cron.test: Bearer 無し／不一致／CRON_SECRET 未設定 → 401、POST は 405。申込 API: GET 405・壊れた本文 400・text/plain 本文で 200 |
| — | Vercel のバンドル | 通った | `vercel build`（デプロイなし）で `api/apply`・`admin`・`cron-notify` が nodejs24.x で生成され、`events.json` と `_lib` が関数に同梱、crons が出力設定に載る |

**切替時に本番で確認するもの**（ここでは確かめられない）

| 項目 | 見るもの |
|---|---|
| 実際の Google ログイン（GIS→tokeninfo→許可リスト） | 清野さん・閲覧のみの運営1名で /admin を開き、前者にだけ操作列が出る |
| 実メール・実 Slack | 手順8のテスト申込で申込者メール1通と運営 Slack 1件、取消で Slack 1件（メール無し）。Slack の「申し込み一覧を開く」が /admin に飛ぶ |
| 本番 Cron | Vercel の Cron Jobs 画面で `/api/cron-notify` が10分おきに 200。手順8でわざと GAS を止める必要はない |
| 関数リージョン | Vercel の Functions 設定が sin1 |
| 旧 HTML からの転送（U12） | 切替前に開いた古いタブから申込 → /admin に source=gas_forward で出る |

## PR

（push・PR 作成は清野さんの合図で。ブランチ: `feature/applications-db`（PR-A）・`feature/applications-db-front`（PR-B・A の上に積む）。GAS はローカル master にコミット済み・未デプロイ）
