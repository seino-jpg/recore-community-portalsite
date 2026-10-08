-- 申込データの正本（design.md ① データ定義）
-- 何度流しても同じ結果になるよう IF NOT EXISTS で書く。
-- 適用: DATABASE_URL=<接続文字列> node scripts/apply-schema.mjs

CREATE TABLE IF NOT EXISTS applications (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_token    uuid        NOT NULL UNIQUE,                 -- フォームが送信ごとに作る（D9）
  event_key           text        NOT NULL,                        -- events.json の key
  event_name          text        NOT NULL,                        -- 申込時点のイベント名（時点値・D4）
  company             text        NOT NULL,
  representative_name text        NOT NULL,
  role                text        NOT NULL,
  email               text        NOT NULL,
  tel                 text        NOT NULL,                        -- 入力原文。数値にしない（D3）
  attendees           text[]      NOT NULL CHECK (cardinality(attendees) >= 1), -- 先頭＝代表者。人数＝配列の長さ（D2）
  car_count           integer     NOT NULL CHECK (car_count BETWEEN 0 AND 5),
  message             text        NOT NULL DEFAULT '',
  status              text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')), -- D5
  received_at         timestamptz NOT NULL DEFAULT now(),          -- UTC。表示は JST
  cancelled_at        timestamptz,
  cancelled_by        text,
  source              text        NOT NULL CHECK (source IN ('site', 'gas_forward', 'sheet_import')), -- D11・D16
  mail_sent_at        timestamptz,                                 -- 未設定＝未通知（D7）
  slack_sent_at       timestamptz,
  notify_attempts     integer     NOT NULL DEFAULT 0,              -- Cron の再試行判断（D8）
  notify_last_error   text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS applications_event_received_idx
  ON applications (event_key, received_at);

-- 履歴（D6）。取消・変更・再送・移行を「誰が・いつ・何を（変更前後）」で残す
CREATE TABLE IF NOT EXISTS application_changes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid        NOT NULL REFERENCES applications (id),
  changed_at     timestamptz NOT NULL DEFAULT now(),
  changed_by     text        NOT NULL,                             -- 操作者のメール。Cron・移行は固定の名前
  action         text        NOT NULL CHECK (action IN ('cancel', 'update', 'notify', 'import')),
  before         jsonb,
  after          jsonb
);

CREATE INDEX IF NOT EXISTS application_changes_application_idx
  ON application_changes (application_id, changed_at);

-- 参加者の区分と運営による登録（2026-10-05-attendee-category の D21・D22）
-- 区分は申込1件ごと。フォーム・移行の行は general（既存行も DEFAULT で general になる）
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'
  CHECK (category IN ('general', 'recore', 'vendor', 'staff'));

-- /admin からの登録（source = 'admin'）と、その履歴（action = 'create'）を許す
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_source_check;

ALTER TABLE applications ADD CONSTRAINT applications_source_check
  CHECK (source IN ('site', 'gas_forward', 'sheet_import', 'admin'));

ALTER TABLE application_changes DROP CONSTRAINT IF EXISTS application_changes_action_check;

ALTER TABLE application_changes ADD CONSTRAINT application_changes_action_check
  CHECK (action IN ('cancel', 'update', 'notify', 'import', 'create'));
