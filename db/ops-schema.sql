-- 運営ボード（docs/designs/2026-10-08-ops-board/design.md のデータ定義）
-- 何度流しても同じ結果になるよう IF NOT EXISTS で書く。
-- 適用: DATABASE_URL=<接続文字列> node scripts/apply-ops-schema.mjs
-- updated_at はミリ秒に丸めて持つ。画面が読み込んだ値と完全一致で比べ、他の人の更新との重なりを判定する（D6）

CREATE TABLE IF NOT EXISTS ops_tasks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key   text        NOT NULL,                                -- events.json の key（D1）
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  owner       text        NOT NULL DEFAULT '' CHECK (char_length(owner) <= 50), -- 自由入力（D4）
  due_date    date,                                                -- null＝期日なし
  status      text        NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  note        text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  updated_at  timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  updated_by  text        NOT NULL                                 -- 操作者のメール。初期データは 'seed'
);

CREATE INDEX IF NOT EXISTS ops_tasks_event_idx ON ops_tasks (event_key);

CREATE TABLE IF NOT EXISTS ops_schedule (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key   text        NOT NULL,
  start_time  time        NOT NULL,                                -- JST の時刻。この順に並ぶ（D5）
  end_time    time        CHECK (end_time IS NULL OR end_time >= start_time), -- null＝時点だけ
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  owner       text        NOT NULL DEFAULT '' CHECK (char_length(owner) <= 50),
  place       text        NOT NULL DEFAULT '' CHECK (char_length(place) <= 50),
  note        text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  updated_at  timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  updated_by  text        NOT NULL
);

CREATE INDEX IF NOT EXISTS ops_schedule_event_idx ON ops_schedule (event_key);
