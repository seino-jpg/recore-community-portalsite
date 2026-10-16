# 参加者の区分タグと、運営による参加者登録：レビュー記録

状態: PR 作成済み
設計書: design.md（確定 2026-10-05）　実装記録: implementation.md（検証済み 2026-10-08）
更新: 2026-10-08

## セルフレビュー（1回目・全体）
見た範囲: recore-community-portalsite@500bf82（98d1fae..500bf82。98d1fae は PR #9 のブランチに PR #8 の最新を取り込んだマージで、この案件の変更を含まない）

コミットの混入: 98d1fae..HEAD の3コミットはすべてこの案件の手順表につながる。衝突: `feature/applications-db-front`・`feature/applications-db`・`main` のどれとも無し。公開リポジトリの追加行に、顧客の社名・社員の氏名・Slack チャンネル ID・example.com 以外のアドレスは無い（自分でも grep して0件）。

| # | 観点 | 指摘 | 根拠 | 重さ | 仕分け |
|---|---|---|---|---|---|
| 1 | ① | 問題なし。D21〜D27 とアウトプット①②③のすべてに対応する変更がある。設計に無い挙動（二重登録の防止・タブ件数・パネルの既定値）は実装記録に理由がある | admin-core.js・validate.js・schema.sql・messages.js・notifier.js・notify.js・admin.html | — | — |
| 2 | ① | 問題なし（実データと操作）。スキーマは何度流しても同じ結果。既存行・フォーム申込は DEFAULT で general。Cron・再送・通知未完了は運営登録だけを外す。行と履歴を1文で入れる CTE は import-sheet.mjs と同じ形で、U27 が実 DB で確かめている | schema.sql:49-62／admin-core.js:84-101 | — | — |
| 3 | ① | 問題なし（画面の状態）。絞り込みは一覧だけ。タブ切替で絞り込みとパネルを戻す。同じ token の間はパネルを作り直さない | admin.html | — | — |
| 4 | ① | 登録パネルは RECORE を選んだ状態で開く（設計の画面③は区分の選択を描いていない）。ベンダーの登録で区分を変え忘れると RECORE で保存される | admin.html:752,758 | 軽微 | PR 本文「設計上の判断」。Slack に区分が出るので気づけ、清野さんが「変更」で直せる |
| 5 | ① | 運営登録の行を取消・変更すると、【申込取消】【申込変更】に「役職未回答」と空のメール・電話の行が出る | messages.js:156-163 | 軽微 | PR 本文「既知の制約」 |
| 6 | ① | ロールバックの注意が無い。運営登録の行がある状態で旧コードに戻すと、旧 Cron がその行を拾い、Slack に新規申込として流し、空の宛先へのメールを最大6回試す | notify.js:83 | 軽微 | PR 本文「デプロイ時の作業」に注意として書く |
| 7 | ② | 問題なし。変更はすべて手順表 #1〜#9・実装中に決めたことにつながる | implementation.md | — | — |
| 8 | ② | 手順表 #9 の test/cron.test.mjs は変更なし（Cron は admin.test.mjs の U32 で確かめた）。`CATEGORY_LABELS`・`RECORE_COMPANY` を export しているが他から使っていない | messages.js:187／validate.js:58 | 軽微 | PR 本文「既知の制約」。直すならレビュー対応と一緒に |
| 9 | ③ | 問題なし。register は cancel・update と同じ順（権限 → 検証 → CTE → notifyChange）。文面は messages.js、送信は notifier.js | admin-core.js:75-110 | — | — |
| 10 | ③ | デプロイ手順②の UPDATE は履歴を残さない（D6）。D23 の「変更」で直せば履歴と【申込変更】が残る | implementation.md:79 | 軽微 | PR 本文「既知の制約」。どちらで直すかはリリース時に決める |
| 11 | ③ | schema.sql の CREATE TABLE の CHECK（source・action）は古い値のまま。正しい値は末尾の ALTER にある。後から値を足す人が CREATE TABLE だけを直すと、本番で新しい値が入らない | schema.sql:22,39,54-62 | 軽微 | PR 本文「既知の制約」 |
| 12 | ③ | 追加行に「清野さん」「ブックオフさん」がある | design.md・implementation.md・test/admin.test.mjs | 軽微 | 採らない。「清野さん」は PR #8 の設計書に、「ブックオフ」は公開中の LP・events.json に前例がある |
| 13 | ④ | 問題なし。U27〜U34 の全行が検証表にあり、テストは検証表の主張を確かめている（47件＝既存40＋追加7） | test/admin.test.mjs | — | — |
| 14 | ④ | 画面の確認（ヘッドレス Chrome 23項目）はスクリプトがリポジトリに無く、U34 に自動テストが無い | implementation.md | 軽微 | QA への依頼（操作動画・テスト手順）で補う |

## recore-review
対象外（seino-jpg/recore-community-portalsite は自分のリポジトリで、RECORE のコア機能ではない）

## 戻し
| 日付 | 戻し先（設計／実装） | 内容 |
|---|---|---|
| — | — | ブロッカー無し |

## PR
| リポジトリ | PR | 向き先 | マージ順 |
|---|---|---|---|
| seino-jpg/recore-community-portalsite | [#11](https://github.com/seino-jpg/recore-community-portalsite/pull/11)（draft） | `feature/applications-db-front`（PR #9。マージ後は main に付け替わる） | PR #8 → PR #9 → この PR（切替の①〜⑥のあと） |

差分をこの案件の変更だけにするため、PR #9 のブランチに PR #8 の最新（10/5 の GAS 廃止）を merge した（183963f。force なし・ツリーは検証済みの状態と同じ）。清野さんの了承（2026-10-08）。

## 依頼
| 相手 | 送ったもの | 日付 |
|---|---|---|
| — | 依頼なし。自分のリポジトリで、前例の PR #8・#9 も外部にレビューを依頼していない。/admin はプレビューでは開けない（D19）ため、画面の確認はデプロイ手順④（本番でテスト登録 → 取消）で行う | 2026-10-08 |

## しょうさんの指摘
| # | 指摘 | 種類 | 対応 | 返信 |
|---|---|---|---|---|
