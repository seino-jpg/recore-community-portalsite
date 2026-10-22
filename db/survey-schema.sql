-- イベント後の参加者アンケート（docs/designs/2026-10-22-event-survey/design.md ② データ定義）
-- 何度流しても同じ結果になるよう IF NOT EXISTS で書く。
-- 適用: DATABASE_URL=<接続文字列> node scripts/apply-survey-schema.mjs

CREATE TABLE IF NOT EXISTS survey_responses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_token uuid        NOT NULL UNIQUE,                    -- フォームが送信ごとに作る（D4）
  event_key        text        NOT NULL,                           -- events.json の key
  answers          jsonb       NOT NULL,                           -- 設問 id → 値（D2）
  questions        jsonb       NOT NULL,                           -- 回答時点の設問定義の写し（D2）
  received_at      timestamptz NOT NULL DEFAULT now(),             -- UTC。表示は JST
  slack_sent_at    timestamptz,                                    -- null＝未通知（D6）
  slack_error      text
);

CREATE INDEX IF NOT EXISTS survey_responses_event_received_idx
  ON survey_responses (event_key, received_at);
