# 申込の GAS とスプレッドシートを廃止する：レビュー記録

状態: PR 作成済み
設計書: design.md（確定 2026-10-05）　実装記録: implementation.md（検証済み 2026-10-05）
更新: 2026-10-05

## セルフレビュー（1回目・全体）
見た範囲: recore-community-portalsite@8ab670e..9b85dd6（main のマージで入った LP の変更は対象外）

| # | 観点 | 指摘 | 根拠 | 重さ | 仕分け |
|---|---|---|---|---|---|
| 1 | ①④ | 確認メールの末尾、URL のあとの区切り線が抜けている。テストが抜けた文面を正解にしているため、U1「文面は今と同じ」を確かめたことになっていない | api/_lib/messages.js:92-96、~/gas-community-form/Mail.js:57-61、test/notifier.test.mjs:73-76、test/apply.test.mjs:41 | ブロッカー | 実装に戻す |
| 2 | ① | design.md の状態が「設計中」のまま（確定の操作が push の hook で止まり、一緒に実行されなかった。確定は 2026-10-05 に清野さんと合意済み） | design.md:3 | 軽微 | 戻しと一緒に記録だけ直す |
| 3 | ① | 認証切れを invalid_grant だけでなく、invalid_client・unauthorized_client・Gmail の 401 でも扱っている。設計 D6 の趣旨（トークンを入れ直すまで全件が失敗する状態）の範囲内 | api/_lib/gmail.js:41-45, 75-76 | 軽微 | PR 本文「設計上の判断」 |
| 4 | ① | 設定表で、Slack チャンネルを「GAS の SLACK_CHANNEL と同じ」としているが、GAS では定数（Slack.js:10）。値は同じ | design.md:48 | 軽微 | PR 本文（切替②で GAS の Slack.js から値を取る） |
| 5 | ② | 手順7の auth.js・validate.js は「GAS と同じ検証」という来歴の説明なので、直していない | implementation.md:33 | 軽微 | 戻しで記録を直す |
| 6 | ② | 申込 HTTP のテストは実行日の時計で判定するため、関西 Vol.2 の締切（11/20）を過ぎると同じように落ちる | test/cron.test.mjs:165 | 軽微 | PR 本文「残課題」 |
| 7 | ④ | encoded-word を含むヘッダー行が76字を超える（RFC 2047 の推奨）。Gmail は受け付ける | api/_lib/gmail.js:93-96 | 軽微 | PR 本文「残課題」 |
| 8 | ④ | /admin の再送で、Slack が失敗してメールで届いた場合も error が返り、PR #9 の画面に「一部失敗」と出る | api/_lib/notify.js:44、admin-core.js:146 | 軽微 | PR 本文「残課題」 |
| 9 | ④ | Gmail が受け付けたあと応答だけタイムアウトした場合や、申込の処理中の行を Cron が拾った場合は二重に送りうる（少なくとも1回は届ける方式の限界。旧設計から同じ） | api/_lib/gmail.js:12、notify.js:78-86 | 軽微 | PR 本文「既知の制約」 |
| 10 | ④ | 本番で通知の設定を1つでも入れ漏れると、何も送らない（/admin に通知未完了と出るだけ） | api/_lib/notifier.js:16-18 | 軽微 | PR 本文（切替⑥で、メールと Slack の両方が届くことを必ず見る） |
| 11 | ④ | U2・U8・U11 と、U7・U12 の本番での確認は、切替時にしかできない | implementation.md 検証表 | 軽微 | PR 本文（リリースの確認項目） |
| 12 | ④ | メールアドレスの検証が緩く、Gmail が 400 を返すと6回再送したあと未通知のまま残る（GAS のときと同じ） | api/_lib/validate.js:4 | 軽微 | PR 本文「既知の制約」 |
| — | ②③ | 問題なし：手順表に無い変更は無い。流儀は gas.js・_sheet.mjs と同じ。公開してはいけない値は diff に無い | — | — | — |

## セルフレビュー（2回目・差分）
見た範囲: recore-community-portalsite@9b85dd6..5fc747b

| # | 観点 | 指摘 | 根拠 | 重さ | 仕分け |
|---|---|---|---|---|---|
| 1 | 前回 #1 | 直った。確認メールの並びが GAS の sendConfirmationMail と全行同じ（署名のアドレスだけ送信元・D4） | api/_lib/messages.js:48-100、Mail.js:8-63 | — | — |
| 2 | テストの期待値 | notifier.test は全文一致、apply.test は末尾の区切り線まで確かめている | test/notifier.test.mjs:38-77、test/apply.test.mjs:41 | — | — |
| 3 | 新しいブロッカー | なし（コードの変更は1行。他の文面に触れていない） | diff 全体 | — | — |

## recore-review
対象外（自分のリポジトリ seino-jpg/recore-community-portalsite。RECORE のコア機能ではない）

## 戻し
| 日付 | 戻し先（設計／実装） | 内容 |
|---|---|---|
| 2026-10-05 | 実装 | #1：確認メールの末尾、URL のあとに区切り線を足し、テスト（notifier.test「新 U1」・apply.test「U1」）の期待値を GAS の全文に合わせ、検証表の U1 を確かめ直す。あわせて #2（design.md の状態を確定に）と #5（手順7の記録）を直す |

## PR
| リポジトリ | PR | 向き先 | マージ順 |
|---|---|---|---|
| seino-jpg/recore-community-portalsite | https://github.com/seino-jpg/recore-community-portalsite/pull/8（既存 PR の本文・タイトルを更新） | main | 1（PR #9 は 2） |

## 依頼
| 相手 | 送ったもの | 日付 |
|---|---|---|
| しょうさん・QA | 対象外（自分のリポジトリ。レビュー依頼なし） | 2026-10-05 |

## しょうさんの指摘
| # | 指摘 | 種類 | 対応 | 返信 |
|---|---|---|---|---|
