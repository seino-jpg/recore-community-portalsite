# 参加者の区分タグと、運営による参加者登録：実装記録

状態: 検証済み
設計書: design.md（確定 2026-10-05）
更新: 2026-10-08

## 既存の確認

| リポジトリ | 同じ機能のブランチ・PR | 似た処理 |
|---|---|---|
| seino-jpg/recore-community-portalsite | 無し。PR #8（`feature/applications-db`・OPEN）と PR #9（`feature/applications-db-front`・DRAFT）が未マージ・切替前。この変更は PR #9 の上に積む（ブランチ `feature/attendee-category`）。**PR #9 のブランチには PR #8 の GAS 廃止（10/5）が入っていなかった**ため、`origin/feature/applications-db` をマージしてから実装した | 取消・変更（`admin-core.js` の `cancel`・`update`）が「更新＋履歴を1文」「Slack にだけ通知」の手本。区分の絞り込みは /admin のイベントタブと同じく画面側で行う |

## 設計書からの読み替え（GAS 廃止に合わせる）

設計書（10/5 夕方）は GAS 廃止（PR #8 の 6eaa5a7）より前に書いたため、通知の行き先だけ読み替える。アウトプットとユースケースは変えない。

| 設計書の記述 | 実装 | 理由 |
|---|---|---|
| ②「GAS の `notify_change` に `type = register` を追加」 | `notifier.js` の `sendChangeNotify` に `register` を足し、文面は `messages.js` に置く | GAS は廃止済み。取消・変更と同じ通り道（Slack→失敗時は運営宛メール）に乗せる |
| U33「Slack 送信が失敗 → 画面に失敗と出す」 | Slack が失敗しメールで届いた場合は成功扱い。Slack もメールも失敗したときだけ「通知に失敗」と出す | 取消・変更の `notifyChange` と同じ判定 |
| ①「株式会社RECORE の行は スキーマ適用時に1回だけ更新」 | `schema.sql` には入れず、デプロイ時の作業で1回だけ流す | `schema.sql` は何度も流す前提。入れると、後から清野さんが一般に戻した行を RECORE に戻してしまう |

## 手本にする実装

| 層 | ファイル | 理由 |
|---|---|---|
| DB | `db/schema.sql` | `IF NOT EXISTS` で何度流しても同じ結果。制約名は既定名（`applications_source_check`・`application_changes_action_check`。検証用 DB で確認済み） |
| API | `api/_lib/admin-core.js` の `cancel`・`update` | 権限判定 → 検証 → CTE で更新と履歴を1文 → `notifyChange` |
| 文面 | `api/_lib/messages.js` の `changeSlackText`・`changeSubject` | 【申込取消】【申込変更】と同じ並び |
| 画面 | `admin.html`（PR #9）の `renderTabs`・`renderSummary`・編集行 | タブの件数表示、集計カード、編集できる人にだけ出すボタン |
| テスト | `test/admin.test.mjs`・`test/cron.test.mjs`・`test/helpers.mjs` | 検証用 DB＋fetch モック。U 番号ごとに1テスト |

## 作業手順

| # | リポジトリ | ファイル | 変更 | つながるアウトプット・ユースケース |
|---|---|---|---|---|
| 1 | portal | `db/schema.sql` | 末尾に追記：`ALTER TABLE applications ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general' CHECK (...)`／`applications_source_check` を DROP IF EXISTS → `'admin'` を足して ADD／`application_changes_action_check` を同様に `'create'` を足して作り直す | ①／U27・U29 |
| 2 | portal | `api/_lib/db.js` | `toApplicationView` に `category` | ①／U27・U34 |
| 3 | portal | `api/_lib/validate.js` | `CATEGORIES`（4値）と `validateRegistration`：区分は4値のみ、RECORE なら会社名を「株式会社RECORE」に、それ以外は会社名必須、氏名1名以上、台数0〜5、メモ任意 | D21・D24／U29 |
| 4 | portal | `api/_lib/messages.js` | `registerSlackText`（【運営登録】イベント名・区分・会社名・参加人数と氏名・台数・メモ・登録者）と件名。`changeLabel` に「区分」と値の日本語名 | D26・D23／U27・U33 |
| 5 | portal | `api/_lib/notifier.js` | `sendChangeNotify` の type に `register` を足し、文面を type で選ぶ | D26／U27・U33 |
| 6 | portal | `api/_lib/admin-core.js` | `register`（閲覧の全員。締切は見ない）：`validateRegistration` → イベントの存在確認 → `INSERT ... ON CONFLICT (submission_token) DO NOTHING` と履歴 `create` を1文 → Slack 通知。`summarize`：社数は一般の有効行だけ、人数・台数・残り枠は全区分、`byCategory` を追加、通知未完了から `source='admin'` を外す。`list` に `canRegister: true`。`update` に `category`。`resend` は運営登録の行を拒否 | D22〜D27／U27〜U33 |
| 7 | portal | `api/_lib/notify.js` | `findPendingForCron` に `AND source <> 'admin'` | D26／U32 |
| 8 | portal | `admin.html` | 集計の人数カードに区分別の内訳、イベントごとの区分の絞り込み（件数付き・一覧だけ絞る）、一覧に区分の列（色ラベル・一般は無地）、通知列は運営登録の行に「運営登録」、「＋参加者を登録」パネル（区分・会社名〈RECORE で自動入力〉・氏名〈＋1名追加〉・台数・メモ。開くたびに submission_token を作る）、編集行に区分の選択（編集できる人だけ）、`isPending` から運営登録を外す | ③／U27・U31・U33・U34 |
| 9 | portal | `test/admin.test.mjs`・`test/cron.test.mjs` | U27〜U34 を足す。U14 の集計の形（社数＝一般のみ・`byCategory`）を更新 | 全ユースケース |

二重登録の防止（パネルが submission_token を作り、API は同じ token を保存しない）は、フォームの D9 と同じ仕組みを使う。ボタンの連打で行が2つ増えないようにするためで、アウトプットは変わらない。

実装中に決めたこと（設計の範囲内）：

- タブと一覧の件数は「有効な申込の件数」で数える。これまでタブは `summary.companies` を件数として出していたが、D27 で社数が一般参加者だけになったため、そのままだと RECORE の行が件数に入らない
- 登録パネルの区分は RECORE を選んだ状態で開く（会社名も入った状態。社内の参加を「ぱぱっと」入れる D24 の主な使い方）。ベンダー・運営に切り替えると、自動で入れた会社名だけ消す
- 登録パネルを開いている間に絞り込みを切り替えても、入力中の内容は消さない
- 区分の列は折り返さない（パネルを開くと「一般」が縦に折れたため）

## 検証

実施日 2026-10-08。DB は検証用（Development の DATABASE_URL。スキーマを2回流して冪等を確認）、Google（tokeninfo・OAuth・Gmail）と Slack は fetch のモック。`npm test` 47 件すべて通過（既存 40＋追加 7）。画面は本物の `handleAdmin`＋検証用 DB をローカルのサーバで動かし、ヘッドレス Chrome（DevTools Protocol）で架空データ（関東 Vol.4 の形：一般15件・うち1件取消）を操作して 23 項目を確認した。

| # | ユースケース | 結果 | 確かめ方 |
|---|---|---|---|
| U27 | 閲覧者が RECORE を2名登録 | OK | `test/admin.test.mjs` U27：区分 recore・会社名 株式会社RECORE・代表者＝氏名の先頭・役職/メール/電話は空・source=admin、人数+2・残り枠-2・社数そのまま・内訳 RECORE2、履歴 create（登録者・登録内容）、Slack【運営登録】の全文一致、メール0通。同じトークンの再送は保存せず Slack も1回。画面：閲覧者でパネルから4名を登録 → 行が増え、RECORE のラベル・通知列「運営登録」・内訳 RECORE4 |
| U28 | 締切後に登録 | OK | U28：締切（9/30）後の 10/5 に関東 Vol.4 へ登録できる。同時刻のフォーム申込は `closed` で 400 |
| U29 | 不正な入力 | OK | U29：氏名0名・空白だけ・台数6・台数空・未知の区分・区分空・会社名空（ベンダー・運営）・未知のイベント・トークン無しの10通りが 400、行・履歴・Slack とも0。画面：会社名が空なら API に送らず止める |
| U30 | 許可リスト外 | OK | U30：許可外・別 aud・期限切れ・無効・トークン無しで `register` が 403、行も Slack も0 |
| U31 | 清野さん以外が区分を変更 | OK | U31：閲覧者の `update`（category）は 403 で DB 不変。清野さんは変更でき、履歴 before/after と【申込変更】に「区分：一般参加者 → RECORE」、社数が1減る。画面：閲覧者に操作列なし、編集者の「変更」で区分の選択が出て、ベンダーに保存 → 絞り込みの件数・社数が変わる |
| U32 | 運営登録の行 | OK | U32：メール0通、通知未完了0、Cron の処理0件、再送は 400。清野さんは取消できる。画面：通知未完了のバッジが出ない |
| U33 | Slack 送信が失敗 | OK | U33：Slack もメールも失敗 → 200・`notified: false`・行は保存。Slack だけ失敗 → 運営宛メール（件名【運営登録】）で届き `notified: true`。画面：「登録しました（運営 Slack への通知は送れませんでした）」と出て行は増える |
| U34 | 区分で絞り込み | OK | 画面：RECORE で1行・ベンダー0件は「該当する申込はありません。」・一般で取消行を含む15行（件数表示は有効14件）。どの絞り込みでも集計カードは変わらない |

2026-10-08 追記：PR #8 のマージと運営ボード（PR #12・#13）で main が進んだため、PR #9 のブランチ経由で main を取り込んだ。admin.html はスマホ幅の CSS（運営ボードのナビと登録パネル）がぶつかったので両方を残した。`npm test` 61 件（運営ボードの 14 件を含む）と画面 24 項目（運営ボードへの切替リンクを追加）を確かめ直し、すべて通過。

スクリーンショット（架空データ）：`after-admin.png`（登録後の一覧）・`after-register-panel.png`（登録パネル）。スマホ幅（390px）でページが横にはみ出さないことも確認した。

## デプロイ時の作業・マージ順

| 順 | 作業 | 誰が |
|---|---|---|
| 前提 | PR #8・#9 の切替（PR #8 本文の①〜⑥）が済んでいる | 清野さん＋Claude |
| ① | 本番 DB にスキーマを適用（`npm run db:schema`。列の追加と制約を広げるだけなので、旧コードのままでも動く） | Claude |
| ② | 関東 Vol.4 の「株式会社RECORE」の行を1回だけ RECORE に更新（`UPDATE applications SET category='recore' WHERE event_key='kanto-vol4' AND company='株式会社RECORE' AND category='general'`。対象行を先に SELECT で確かめる） | Claude |
| ③ | この PR をマージ（向き先は PR #9 のマージ後に main へ付け替わる）。このブランチは PR #8 の最新を取り込んでいるので、PR #9 が PR #8 の最新を取り込む前に向き先を `feature/applications-db-front` にすると、差分に PR #8 の 10/5 の変更が混ざる | 清野さん |
| ④ | 本番で関西 Vol.2 にテスト登録 → Slack に【運営登録】が届く → 取消 | 清野さん＋Claude |

公開リポジトリなので、設計書・テストに Slack チャンネル ID・個人のアドレスを書かない。push には毎回 `! touch ~/.claude-business/.allow-public-push` が要る。

## レビューからの戻り

| 日付 | 指摘 | 対応 |
|---|---|---|
