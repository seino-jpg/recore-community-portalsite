# イベント後の参加者アンケート：レビュー記録

状態: PR 作成済み
設計書: design.md（確定 2026-10-22）　実装記録: implementation.md（検証済み 2026-10-22）
更新: 2026-10-22

## セルフレビュー（1回目・全体）
見た範囲: seino-jpg/recore-community-portalsite@1869d79（origin/main...HEAD。コミットは bda79dd 設計・1869d79 実装の2つだけで、どちらもこの案件。main との衝突なし）

| # | 観点 | 指摘 | 根拠 | 重さ | 仕分け |
|---|---|---|---|---|---|
| 1 | ① | D1〜D8 とアウトプット①〜④は全部 diff に対応がある | events.json:14／db/survey-schema.sql:5-14／api/_lib/survey-core.js:32,43-52,73-115,141-149／api/_lib/survey-admin-core.js:8-46／admin-survey.html:479-494／survey.html:1126 | 問題なし | ― |
| 2 | ① | 配備で壊れる所は無い。DDL は IF NOT EXISTS。新しい環境変数なし。「マージ前に DDL」の順は必須（逆だと /api/survey が 500） | db/survey-schema.sql:5-17／implementation.md:52-55 | 問題なし | ― |
| 3 | ① | 設問の文言が確定案から2か所変わっている。Q4「Q3 を選んだ理由…」→「上記を選んだ理由…」、Q6「Q5 で選んだ内容について…」→「選んだ内容について…」。記録なし | events.json:41,61／設問案 10・19行 | 軽微（レビュワー）→ **ブロッカー** | 実装に戻す。清野さんが「この内容で進める」で確定した文言で、アウトプットが設計と違う。番号は並び順で振るので Q3・Q5 のままで食い違わない |
| 4 | ① | D1「書き足すだけで次も使える」に対し固定の前提が4つ（尺度の両端の言葉、Slack 文面が id 固定、集計タイルが最初の scale、列の幅が satisfaction 固定）。関東 Vol.4 では噛み合う | survey.html:1058／survey-core.js:124-134／admin-survey.html:374-379,467 | 軽微 | PR 本文（既知の制約） |
| 5 | ① | 一覧の見出しは今の定義、値は保存した文字列。U12（選択肢の文言を直す）は期待どおり。ただ見出しを直すと過去の回答にも新しい見出しが付き、設問を消すと列が一覧と CSV から消える（DB には残る） | admin-survey.html:434-446／survey-admin-core.js:35-42 | 軽微 | PR 本文（既知の制約）。設計は変えない（データは写しで残っており D2 は満たす） |
| 6 | ① | 未確定事項「配り方」の回答が空 | design.md:105 | 軽微 | PR 本文（残課題）。リリースで案内を下書きするときに清野さんに聞く |
| 7 | ② | アウトプットにつながらない変更は無い。CSS の複製で未使用の規則が付いてくるのは apply.html と同じ流儀 | git diff --stat | 問題なし | ― |
| 8 | ② | 実装記録と実際の差が2つ。db.js の toSurveyResponseView が手順表に無い。README は「表に2行」より広い（節 2b・ツリー・表） | implementation.md:25-32／api/_lib/db.js:41-50／README.md | 軽微 | 実装に戻す（同梱。記録の修正だけ） |
| 9 | ③ | /admin/survey のロゴが 404。`href="index.html"` が `/admin/index.html` に解決し、rewrite も無い。同じ `/admin/…` 配信の ops.html は `href="/"` | admin-survey.html:202／vercel.json:10-11／ops.html:212 | **ブロッカー** | 実装に戻す（自分でも vercel.json と href を見て確認） |
| 10 | ③ | 共有の resetDb に survey_responses を足したため、表の無い DB では申込・管理・Cron の既存テストまで全部落ちる。手本の ops.test.mjs は自分の表を自分の beforeEach で空にしている | test/helpers.mjs:26／test/ops.test.mjs:3,62 | 軽微 | 実装に戻す（同梱。手本どおりに戻すだけ） |
| 11 | ③ | Slack の文面と通知の記録が survey-core.js にある（手本は文面を messages.js、送信を notifier.js）。名前の並びが survey-admin.js と admin-survey.html で逆 | survey-core.js:121-149／messages.js:136,156 | 軽微 | PR 本文（設計上の判断） |
| 12 | ③ | 公開フォームの自由記述が CSV にそのまま出る。先頭が `=` `+` `-` `@` の回答は Excel で式として扱われうる。Slack 文面も `<!channel>` 等を無害化しない（申込の通知と同水準） | admin-survey.html:483／survey-core.js:124-133 | 軽微 | PR 本文（既知の制約）。D7「そのまま書き出す」を変える話なので実装では決めない。承認のときに清野さんに示す |
| 13 | ③ | 顧客情報・認証情報・社内情報は入っていない（メールは公開済みの1つ、クライアント ID は公開値、テスト値は架空） | survey.html:985,1125,1171／admin-survey.html:251 | 問題なし | ― |
| 14 | ③ | 手本との整合は取れている（api/survey.js は apply.js と同形、管理 API は authenticateAdmin、回答者の文字列は textContent で XSS なし） | api/survey.js／admin-survey.html:293,386,397,440-446 | 問題なし | ― |
| 15 | ④ | U1〜U12 は全部検証表にあり、テストが期待どおりの値を確かめている（68件） | implementation.md:37-50／test/survey.test.mjs | 問題なし | ― |
| 16 | ④ | U12 の期待は「表示」だが画面の確認記録が無い。手で確かめた行に「自動にしない理由」が無い（DOM を試す基盤が無いこと） | implementation.md:34-49 | 軽微 | 実装に戻す（同梱。U12 を画面でも確かめ、理由を1行足す） |
| 17 | ④ | U2 のテスト名が「空配列」と言うが、任意の checkbox が無いので空配列は確かめていない | test/survey.test.mjs:66-74 | 軽微 | 実装に戻す（同梱。名前と記録を「任意は空文字」に直す） |

仕分けの考え方：ブロッカー（#3・#9）で実装に戻すので、記録・テストだけで済む軽微（#8・#10・#16・#17）は同じ戻しに入れる（周回は増えない）。設計の判断が要る軽微（#12）と、直すと設計が広がる軽微（#4・#5・#11）は PR 本文に回す。

## セルフレビュー（2回目・差分）
見た範囲: seino-jpg/recore-community-portalsite 1869d79..2c828a3（前回のブロッカー #3・#9 と、同じ戻しで直した #8・#10・#16・#17 の副作用だけ）

| # | 観点 | 指摘 | 根拠 | 重さ | 仕分け |
|---|---|---|---|---|---|
| 1 | 前回 #3（文言） | Q4・Q6 が設問案と一致。13問の label・必須/任意・選択肢を設問案と照合し、差は Q5 の「（複数選択可）」だけ（1869d79 から変わらず、設問案の「複数選択」の注記を画面に出したもの） | events.json:41,47,61／設問案:10,12,19 | 問題なし | ― |
| 2 | 前回 #3（番号の整合） | 画面の番号は並び順で振るので「Q4. Q3 を選んだ理由…」「Q6. Q5 で選んだ内容について…」と出て、文中の Q3・Q5 は満足度と参考になった内容を指す。テストに文言を見る所は無い | survey.html:1032-1034／admin-survey.html:416,436 | 問題なし | ― |
| 3 | 前回 #9（ロゴ） | `href="/"` に直った（ops.html と同じ）。/ はルートの index.html を返す | admin-survey.html:202／ops.html:212／vercel.json:5-11 | 問題なし | ― |
| 4 | 前回 #9（同じ原因の取りこぼし） | /admin/survey に相対参照はもう無い。admin.html・survey.html の `index.html` は直下で配信されるので /index.html に解決し無害 | admin-survey.html:8-10,202-206,254,304,511／admin.html:186／survey.html:943 | 問題なし | ― |
| 5 | 副作用（#10） | resetDb は main と同一。survey_responses は survey.test.mjs の beforeEach で空にする（ops.test.mjs と同じ） | test/helpers.mjs:25-27／test/survey.test.mjs:5,9-11／test/ops.test.mjs:62 | 問題なし | ― |
| 6 | 副作用（#17） | 足した空配列の確認は成立（DB なしで validateAnswers を呼んで確認）。戻しの「名前を直す」とは違うが、理由は implementation.md にあり、設計 U2 の期待（空文字・空配列）に合う。テスト数は68のまま | test/survey.test.mjs:76-80／implementation.md:64 | 問題なし | ― |
| 7 | 副作用（#8） | 手順表の4・7・8行が実際の差分と一致。戻り表の6行は戻しの①〜⑥に1対1 | implementation.md:28,31,32,61-66 | 問題なし | ― |
| 8 | 副作用（範囲・配備） | 2c828a3 は5ファイルだけ。U12 の確認で一時的に変えた Q8 の選択肢は戻っている。DDL・環境変数・rewrite の変更なし | events.json:76-80／vercel.json:5-11 | 問題なし | ― |
| 9 | 副作用（#16） | 今回足した検証表の「戻し」行は、手の確認なのに理由が無い（#16 と同じ型） | implementation.md:49 | 軽微 | 戻さない。記録だけの食い違いで、理由は U1 行の一文と同じ |
| 10 | 副作用（#3） | 文言を設問案に戻したので、label の中の「Q3」「Q5」は文字で固定。次のイベントで設問を足す・並べ替えると、見出しの番号だけが動いて文中の番号が古くなる（関西 Vol.2 に survey はまだ無く、今は0件） | events.json:41,61／survey.html:1032 | 軽微 | PR 本文（既知の制約。1回目 #4 の D1 の固定の前提に並べた） |
| 11 | 範囲外 | 設問案 .txt は未追跡のままで、design.md と review.md が参照している | design.md:20／review.md:14 | 軽微 | PR 本文（補足：作業用のファイルでリポジトリに入れない。確定した13問は events.json が正本） |

結果：前回のブロッカー2件は直り、新しいブロッカーは無い（ブロッカー0・軽微3）。PR に進む。

## recore-review
対象外（社内ツール）

## 責任者
対象外（表に無い）

## 戻し
| 日付 | 戻し先（設計／実装） | 内容 |
|---|---|---|
| 2026-10-22 | 実装 | ① #9 `admin-survey.html` のロゴを `href="/"` に（ops.html と同じ）。② #3 `events.json` の Q4・Q6 の文言を設問案どおりに戻す（「Q3 を選んだ理由をお聞かせください」「Q5 で選んだ内容について、どんな点が参考になりましたか」）。③ #10 `test/helpers.mjs` の resetDb を元に戻し、`test/survey.test.mjs` の beforeEach で survey_responses だけ空にする（ops.test.mjs と同じ）。④ #17 U2 のテスト名と記録を「任意は空文字」に。⑤ #16 U12 を画面でも確かめ、手で確かめた行に理由（DOM を試す基盤が無い）を書く。⑥ #8 implementation.md の手順表に db.js の行を足し、README の行を実際に合わせる |

## PR
| リポジトリ | PR | 向き先 | マージ順 | CI |
|---|---|---|---|---|
| seino-jpg/recore-community-portalsite | https://github.com/seino-jpg/recore-community-portalsite/pull/19 | main | 1つだけ（マージ前に本番 DB へ `db/survey-schema.sql`） | 通過（Vercel のプレビュー、2c828a3。GitHub Actions は無い） |

## 依頼
不要（社内ツール）

## レビュワーの指摘
| # | 誰から | 指摘 | 種類 | 対応 | 返信 |
|---|---|---|---|---|---|
