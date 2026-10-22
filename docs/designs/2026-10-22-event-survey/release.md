# イベント後の参加者アンケート：リリース記録

状態: リリース済み
設計書: design.md（確定 2026-10-22）　レビュー記録: review.md（承認済み 2026-10-22）
更新: 2026-10-22

## 担当者
区分: 社内ツール（体制表）　担当: 清野さん（自分でマージ）　依頼日: ―

## 担当者に渡す情報
| 項目 | 内容 |
|---|---|
| PR とマージ順 | https://github.com/seino-jpg/recore-community-portalsite/pull/19 （main へ。PR は1つだけ） |
| デプロイ時の作業 | マージ前に本番 DB へ `db/survey-schema.sql`（survey_responses と索引。IF NOT EXISTS）。承認のときは清野さんが Neon のコンソールの SQL Editor で流したが、本番（recore-community-db）に入っておらず、マージ後の 19:10 に Claude が本番の main に流し直した（「本番での確認」の #2） |
| リポジトリ間の依存 | なし |
| 希望日・期日 | 2026-10-22 中（16:30 の終了後、できるだけ早く参加者に配る）。回答の締切は 2026-10-31 23:59 JST |
| CI の結果 | Vercel のプレビュー pass（6d317b1。マージ直前に見直した）。GitHub Actions は無い |

## 本番での確認
戻し方: Vercel の本番デプロイを、マージ前の main（8c0329c）のデプロイに戻す（Instant Rollback）。survey_responses の表は残っても、ほかの機能は読まないので害はない
stg: stg なし（PR のプレビューは本番の DB・Slack につながないので代わりにしない）
リリース日: 2026-10-22 18:47（PR #19 のマージ、248e0bc）　デプロイ: 成功（Vercel の本番）　自動確認: なし

| # | ユースケース | 本番での確かめ方 | 誰が | stg | 本番 |
|---|---|---|---|---|---|
| 1 | U1 通常（ページ） | https://recore-community-portalsite.vercel.app/survey?event=kanto-vol4 に「ご参加者アンケート」・13問・締切「2026年10月31日（土）」が出る | Claude（内蔵ブラウザで読むだけ） | ― | OK（18:48。13問・締切「2026年10月31日（土）」・Q4/Q6 は設問案どおり・フォームあり） |
| 2 | ② 表・U10 集計 | /admin/survey の関東 Vol.4 がエラーなく開き、回答0件（表が無ければ取得でエラーになる） | Claude（Google ログインが要る） | ― | NG（18:53。画面に「処理に失敗しました」。本番のログ（Vercel、18:52:56 の POST /api/survey-admin）は `relation "survey_responses" does not exist`。DDL が recore-community-db の main（neondb）に入っていなかった。メールは送る前なので、エラーに当たった参加者はいない）→ 19:10 に Claude が流し直した（清野さんの指示「流して」。Orca の内蔵ブラウザの Neon のタブで recore-community-db / main / neondb の SQL Editor に `db/survey-schema.sql` を入れて Run、「1: CREATE 2: CREATE Statement executed successfully」。表・索引・submission_token の一意制約が main にあることを Neon の schema で確認）。戻さない：コードの直しは要らず、予定していたデプロイ時の作業を本番に届かせるだけのため。原因：同じ組織に recore-community-db-dev（手元の検証用。表は前からあった）があり、どちらにもブランチ main と DB neondb があるので、「main・neondb」の確かめ方では取り違えを防げない → OK（19:12。清野さんの再ログインのあと、関東 Vol.4 が回答0件・満足度の平均「—」・Slack 通知の失敗0件で開き、Q3・Q5・Q8・Q10 の集計が全部0件、一覧は「まだ回答はありません」） |
| 3 | U1 通常（保存と Slack） | 最初の参加者の回答で、/admin/survey に1件・運営 Slack に1件。テストの回答は送らない（2026-10-22 清野さんの判断） | Claude（最初の回答のあと） | ― | 最初の回答待ち |
| 4 | U8 アンケート無し | /survey?event=kansai-vol2 で「対象のアンケートが見つかりません」 | Claude | ― | OK（18:48。文言が出て、フォームは非表示） |
| 5 | 既存の機能 | /・/kanto-vol4・/apply・/admin・/admin/ops が今までどおり開く | Claude | ― | OK（18:48。5ページとも 200・タイトルどおり。/survey・/admin/survey も 200、/api/survey の GET は 405） |

## 案内
送り先: 関東 Vol.4 の参加企業13社（TO）と運営（CC）。宛先は 10/21 の「参加企業のご紹介」と同じ　手段: メール（Gmail の下書き。送るのは清野さん。2026-10-22 清野さんの判断）　送付日: 2026-10-22 21:28 ごろ（清野さんが送信）

```
件名：【関東コミュニティ Vol.4】ご参加ありがとうございました／アンケートのお願い

関東コミュニティ Vol.4（ブックオフ出品倉庫 見学会）にご参加いただいた皆さま

お世話になっております。RECORE コミュニティ運営の清野です。
本日はブックオフ出品倉庫の見学会にご参加いただき、ありがとうございました。

今後のコミュニティの企画に活かすため、アンケートへのご協力をお願いします。
所要時間は3分ほどで、スマートフォンからもお答えいただけます。

■ アンケート
https://recore-community-portalsite.vercel.app/survey?event=kanto-vol4
回答期限：10月31日（土）23:59

■ お願い
・ご一緒に参加された方にも、このメールをご共有ください（お一人ずつお答えいただけます）
・いただいた回答は運営メンバーで拝見し、次回以降の企画に活かします

ご不明な点があれば、このメールにご返信ください。
引き続きよろしくお願いいたします。

RECORE コミュニティ運営　清野
```

## 学び
