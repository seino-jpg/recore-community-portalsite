# イベント後の参加者アンケート：実装記録

状態: 検証済み
設計書: design.md（確定 2026-10-22）
更新: 2026-10-22

## 既存の確認
| リポジトリ | 同じ機能のブランチ・PR | 似た処理 |
|---|---|---|
| seino-jpg/recore-community-portalsite | 無し（PR・ブランチを「アンケート」「survey」で確認、2026-10-22） | 申込の `api/_lib/apply-core.js`（トークンで二重送信を防ぐ INSERT・締切判定 `isClosed`）、`slack.js` の `postToSlack`、`auth.js` の `authenticateAdmin` をそのまま使う |

## 手本にする実装
| 層 | ファイル | 理由 |
|---|---|---|
| DB | `db/ops-schema.sql`・`scripts/apply-ops-schema.mjs` | 機能ごとに DDL と適用スクリプトを分けている（申込・運営ボード） |
| 回答 API | `api/apply.js`・`api/_lib/apply-core.js` | 公開フォームの受付（トークン・締切・検証・保存後に通知） |
| 管理 API | `api/ops.js`・`api/_lib/ops-core.js` | 管理画面ごとに入口を分け、`authenticateAdmin` を通す |
| 回答ページ | `apply.html` | 公開フォームの見た目・`?event=` 切替・送信ごとのトークン |
| 管理ページ | `admin.html`・`ops.html` | Google ログイン（GIS）・ヘッダーのページ切替・タブ |
| テスト | `test/apply.test.mjs`・`test/helpers.mjs`・`test/ops.test.mjs` | 検証用 DB＋fetch のモック（Slack・tokeninfo）。自分の表は自分の beforeEach で空にする（ops.test.mjs） |

## 作業手順
| # | リポジトリ | ファイル | 変更 | つながるアウトプット・ユースケース |
|---|---|---|---|---|
| 1 | portalsite | `db/survey-schema.sql`・`scripts/apply-survey-schema.mjs` | survey_responses を作る（IF NOT EXISTS） | ② |
| 2 | portalsite | `events.json` | `kanto-vol4.survey`（deadline・title・lead・13問） | ①・D1・D8 |
| 3 | portalsite | `api/_lib/survey-core.js`・`api/survey.js` | 回答の受付：定義の取得・締切・検証・保存・Slack・失敗の記録 | ③・U1〜U9・U12 |
| 4 | portalsite | `api/_lib/survey-admin-core.js`・`api/survey-admin.js`・`api/_lib/db.js` | 管理の一覧：認証・イベントごとの回答と集計。回答行を応答の形にする `toSurveyResponseView` は、申込の `toApplicationView` と同じ db.js に置く | ③・U10・U11 |
| 5 | portalsite | `survey.html` | 回答ページ（設問を定義から描く・締切・完了） | ④・U1・U7・U8 |
| 6 | portalsite | `admin-survey.html`・`admin.html`・`ops.html`・`vercel.json` | 管理ページ（集計・一覧・CSV）。ヘッダーに「アンケート」、`/survey`・`/admin/survey` の rewrite | ④・U9・U10・U12 |
| 7 | portalsite | `test/survey.test.mjs` | U1〜U12 のテスト。survey_responses は自分の beforeEach で空にする（ops.test.mjs と同じ。共通の resetDb は触らない） | 検証 |
| 8 | portalsite | `README.md` | 節「2b. 参加者アンケート」（設問の正本・回答の流れ・締切・管理ページ・公開後に id を変えない）、ファイル構成のツリーに survey.html、配信 URL の表に2行 | ① |

## 検証
| # | ユースケース | 結果 | 確かめ方（テスト名／手。手なら理由） |
|---|---|---|---|
| U1 | 通常 | 通った | `U1 通常: 13問を保存・Slack に1件・slack_sent_at`。画面も手で（画面を自動で試す基盤が無い。以下の「画面も手で」も同じ）：全問を選んで送信 → 完了画面「ご回答ありがとうございました。」、Slack（モック）に会社名・お名前・満足度・参考になった内容・感想・回答日時・/admin/survey へのリンク |
| U2 | 任意を空 | 通った | `U2 任意を空: 必須6問だけで保存。任意は空文字・空配列`。関東 Vol.4 に任意の複数選択は無いので、空配列は定義に1問足して `validateAnswers` で確かめる |
| U3 | 必須漏れ | 通った | `U3 必須漏れ: 参考になった内容が0件は 400・保存しない`。画面も手で：Q1〜Q3 だけで送信 →「必須の設問（Q5・Q8・Q10）にご回答ください。」 |
| U4 | 範囲外 | 通った | `U4 範囲外: 満足度 11・0・小数、定義外の選択肢は 400` |
| U5 | 長すぎ | 通った | `U5 長すぎ: 段落 2001字・記述 101字は 400、2000字・100字は通る` |
| U6 | 二重送信 | 通った | `U6 二重送信: 同じトークンは1件・Slack も1件` |
| U7 | 締切 | 通った | `U7 締切: 10/31 23:59:58 は受付、23:59:59 は closed`。画面も手で（検証用サーバーで時刻を固定）：23:59:58 は送信できる、23:59:59 はフォームを出さず「アンケートの受付は終了しました（締切：2026年10月31日（土））」、API は code=closed |
| U8 | アンケート無し | 通った | `U8 アンケート無し: survey 未定義のイベント・未知の key・トークン不正は 400`。画面も手で：`?event=kansai-vol2`・`?event=nope` で「対象のアンケートが見つかりません」 |
| U9 | Slack 失敗 | 通った | `U9 Slack 失敗: 回答は 200 で保存し slack_error に理由。未設定（プレビュー）は送らず未通知`。画面も手で：Slack を失敗させて送信 → 完了画面、/admin/survey の「Slack 通知の失敗 1件」と行の「失敗：Slack API error: channel_not_found」 |
| U10 | 集計 | 通った | `U10 集計: 満足度 8・10・9 → 平均 9.0・分布、ピッキング 2件`。画面も手で：同じ3件で平均 9.0・分布・選択肢の棒、一覧、CSV（BOM 付き、ヘッダー＋3行、`survey-kanto-vol4-20261022.csv`） |
| U11 | 権限 | 通った | `U11 権限: 許可リストに無いアカウント・トークン無しは 403` |
| U12 | 設問を後で直す | 通った | `U12 設問を後で直す: 写しの文言と回答の値はそのまま、件数は後ろに足す`。画面も手で：回答を1件送ったあと、Q8 の選択肢「ちょうどよかった」を手元で一時的に「ちょうどよい」に変えて /admin/survey を開く → 一覧の Q8 は「ちょうどよかった」のまま、Q8 の集計は今の選択肢3つが0件で、末尾に「ちょうどよかった 1」が薄く出る（変えた定義は戻した） |
| 画面 | スマホ幅（390px） | 通った | 手（見た目は自動テストの外）：満足度は5列×2段、選択肢は折り返して1列、申込ページと同じ余白 |
| 戻し | ロゴ・設問の文言（review.md の #9・#3） | 通った | 手：/admin/survey のロゴの href が `/`。/survey の Q4・Q6 と /admin/survey の一覧の見出しが設問案どおり（「Q3 を選んだ理由をお聞かせください」「Q5 で選んだ内容について、どんな点が参考になりましたか」） |
| CI | CI と同じ検査（`npm test`。CI は無いので package.json の test） | 通った | 手元で実行、68件すべて通過（検証用 DB）。初回は3回、戻しの後に1回 |

## デプロイ時の作業・マージ順
| リポジトリ | ブランチ | 向き先 | マージ順 | デプロイ時の作業 |
|---|---|---|---|---|
| portalsite | feature/event-survey | main | 1つだけ | マージ前に本番 DB へ `db/survey-schema.sql` を清野さんが Neon のコンソールで流す |

## レビューからの戻り
| 日付 | 指摘 | 対応 |
|---|---|---|
| 2026-10-22 | #9 /admin/survey のロゴが 404 | `admin-survey.html` のロゴを `href="/"` に（ops.html と同じ）。画面で確認 |
| 2026-10-22 | #3 Q4・Q6 の文言が設問案と違う | `events.json` を設問案どおりに戻した。回答ページと一覧の見出しで確認 |
| 2026-10-22 | #10 共有の resetDb に survey_responses を足していた | resetDb を main と同じに戻し、`survey.test.mjs` の beforeEach で survey_responses だけ空にする（ops.test.mjs と同じ） |
| 2026-10-22 | #17 U2 のテスト名が空配列と言うのに確かめていない | 名前を削るかわりに、任意の複数選択を1問足した定義で空配列を確かめた。設計の U2 の期待が「空文字・空配列」なので、期待を確かめる方を取った |
| 2026-10-22 | #16 U12 の画面の確認が無い・手の行に理由が無い | U12 を画面で確かめて検証表に書いた。手で確かめた行に「画面を自動で試す基盤が無い」を書いた |
| 2026-10-22 | #8 手順表が実際と違う（db.js・README） | 手順表の4・7・8行を実際の変更に合わせた |

## 実装中の学び
- 同じ時刻で複数件を入れるテストは、並び（received_at, id）が uuid 次第で揺れる。並びを確かめるなら時刻をずらす（U10 で一度落ちた）
- 共通のテスト準備（resetDb）に自分の表を足すと、その表の無い DB では他の機能のテストまで落ちる。自分の表は自分のテストファイルで空にする（レビュー #10）
