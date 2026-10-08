# 関東 Vol.4 の運営ボード：レビュー記録

状態: 承認済み
設計書: design.md（確定 2026-10-08）　実装記録: implementation.md（検証済み 2026-10-08）
更新: 2026-10-08

## セルフレビュー（1回目・全体）
見た範囲: seino-jpg/recore-community-portalsite@3246913（origin/main...HEAD）

| # | 観点 | 指摘 | 根拠 | 重さ | 仕分け |
|---|---|---|---|---|---|
| 1 | ① | D1〜D12 はすべて diff で指せる。After 画像と画面構成が一致 | ops-core.js・ops.html・vercel.json・admin.html・ops-seed.sql | — | 問題なし |
| 2 | ① | D6「各行に最終更新者・時刻」が当日スケジュールの行に無い（合意した After 画像にも無い） | ops.html `scheduleRow`／design.md D6 | 軽微 | PR 本文「設計上の判断」（画像どおり。要るなら PR のレビュー対応で足す） |
| 3 | ① | 保存後は一覧を読み直さず、その行だけ差し替える（処理の流れ図とは一致） | ops.html `saveEdit` | 軽微 | PR 本文「設計上の判断」 |
| 4 | ① | 重なりの表示が全項目を並べる（画像は変わった項目だけ） | ops.html `editForm` | 軽微 | PR 本文「設計上の判断」 |
| 5 | ② | 手順表どおり。admin.html はヘッダーの切替とスマホ CSS だけ | implementation.md 手順表 | — | 問題なし |
| 6 | ② | `package.json` の `db:schema` が PR #8 の `apply-schema.mjs`（このブランチに無い）を指す | package.json | 軽微 | PR 本文「既知の制約」 |
| 7 | ③ | 入口・スキーマ適用は手本と同形。admin.html の権限処理は無変更。マージ順どおりなら衝突なし | api/ops.js・scripts/apply-ops-schema.mjs | — | 問題なし |
| 8 | ③ | SQL が `sql.query`（手本はタグ付きテンプレート）。`isUuid` が PR #8 の validate.js と重複 | ops-core.js | 軽微 | PR 本文「設計上の判断」（列リストの共有のため。isUuid は PR #8 マージ後に寄せる） |
| 9 | ③ | テストが helpers.mjs を使わず内製。本番らしい DB 名での中止 guard が無い | test/ops.test.mjs | 軽微 | PR 本文「既知の制約」（PR #8 マージ後に helpers へ寄せる） |
| 10 | ③ | ログインが `auto_select: true`＋同じタブの再読込でトークンを使い回す（admin.html と違う） | ops.html | 軽微 | PR 本文「設計上の判断」（D12：当日は開きっぱなし・再読込が多い） |
| 11 | ④ | U1〜U18 全行に結果あり。字数の境界はテスト済み | implementation.md 検証表 | — | 問題なし |
| 12 | ④ | U17 は test と vercel dev で確認。実際のプレビュー URL は未確認 | implementation.md U17 | 軽微 | PR 作成後に確認した：プレビューで `/admin/ops` 表示・`/api/ops` 403（設定なし）。PR 本文に追記 |
| 13 | ④ | 375px は初期データの長さでだけ確認（100字・1000字の折返しは未記録） | implementation.md U12 | 軽微 | PR 本文「既知の制約」 |
| 14 | 追加 | 削除は更新時刻を照合しない（他の人の変更ごと消えうる） | ops-core.js `remove` | 軽微 | PR 本文「既知の制約」（D8 は確認のみ。5名で起きにくい） |
| 15 | 追加 | 編集中の行を他の人が削除すると、再読込で編集フォームが黙って消える | ops.html `render` | 軽微 | PR 本文「既知の制約」 |
| 16 | 追加 | ログイン切れ中の削除は、ログインし直したあと確認ダイアログがもう一度出る | ops.html `deleteRow` | 軽微 | PR 本文「既知の制約」 |
| 17 | 追加 | 一行項目の連続空白・全角スペースが半角1つになる | ops-core.js `str` | 軽微 | PR 本文「既知の制約」 |
| 18 | 追加 | 並行編集・SQL・XSS・タイムゾーン・ログイン切れの再開は問題なし | ops-core.js・ops.html | — | 問題なし |

ブロッカー 0件。軽微な指摘は戻さず PR 本文に回す。

## recore-review

対象外（seino-jpg の自分のリポジトリ。RECORE のコア機能ではない）

## 戻し
| 日付 | 戻し先（設計／実装） | 内容 |
|---|---|---|

## PR
| リポジトリ | PR | 向き先 | マージ順 |
|---|---|---|---|
| seino-jpg/recore-community-portalsite | https://github.com/seino-jpg/recore-community-portalsite/pull/12（draft） | main | PR #8・#9 より先でよい |

## 依頼
| 相手 | 送ったもの | 日付 |
|---|---|---|
| 清野さん | draft PR #12（自分のリポジトリのため、しょうさん・QA への依頼は対象外） | 2026-10-08 |

## しょうさんの指摘
| # | 指摘 | 種類 | 対応 | 返信 |
|---|---|---|---|---|
