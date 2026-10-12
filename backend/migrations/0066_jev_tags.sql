-- Jev tags: user-defined tags that a TypeSafe "Jev" model assigns to incoming mail.
--
-- Every tag is a yes/no question (a "noul"): instructions plus optional true/false descriptions and
-- examples. Tags are stored in the database only - nothing is ever written to the IMAP server.
--
--   tag_definitions   one row per tag per user (private / important / urgent are seeded on first use)
--   tag_settings      per-user Jev API key (encrypted) and the confidence thresholds
--   message_tags      the Jev answer (score) per message and tag, kept to justify the tag in the UI
--   message_tag_runs  one row per classified message: which pass ran, whether the body left the server

CREATE TABLE IF NOT EXISTS tag_definitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key            VARCHAR(40) NOT NULL,
  name           VARCHAR(80) NOT NULL,
  color          VARCHAR(9) NOT NULL DEFAULT '#6b7280',
  -- 'privacy' is the gate: a message scoring above the private threshold is tagged and its body is
  -- never sent. At most one per user.
  role           VARCHAR(10) NOT NULL DEFAULT 'tag' CHECK (role IN ('tag', 'privacy')),
  instructions   TEXT NOT NULL,
  true_what      TEXT,
  true_examples  JSONB NOT NULL DEFAULT '[]',
  false_what     TEXT,
  false_examples JSONB NOT NULL DEFAULT '[]',
  -- NULL = use the user's default band from tag_settings.
  threshold_low  NUMERIC(3,2),
  threshold_high NUMERIC(3,2),
  position       INTEGER NOT NULL DEFAULT 0,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_definitions_one_privacy
  ON tag_definitions (user_id) WHERE role = 'privacy';

CREATE TABLE IF NOT EXISTS tag_settings (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key_enc     TEXT,
  threshold_low   NUMERIC(3,2) NOT NULL DEFAULT 0.35,
  threshold_high  NUMERIC(3,2) NOT NULL DEFAULT 0.65,
  private_above   NUMERIC(3,2) NOT NULL DEFAULT 0.40,
  max_body_chars  INTEGER NOT NULL DEFAULT 500,
  model           VARCHAR(80) NOT NULL DEFAULT 'jev-latest',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_tags (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tag_definitions(id) ON DELETE CASCADE,
  -- Jev's probability for the yes/no question; NULL when the tag was set by hand.
  score      NUMERIC(4,3),
  applied    BOOLEAN NOT NULL,
  source     VARCHAR(10) NOT NULL DEFAULT 'jev' CHECK (source IN ('jev', 'manual')),
  pass       SMALLINT,
  body_sent  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_message_tags_tag ON message_tags (tag_id) WHERE applied;

CREATE TABLE IF NOT EXISTS message_tag_runs (
  message_id    UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  status        VARCHAR(10) NOT NULL CHECK (status IN ('done', 'error', 'skipped')),
  pass          SMALLINT NOT NULL DEFAULT 1,
  body_sent     BOOLEAN NOT NULL DEFAULT false,
  is_private    BOOLEAN NOT NULL DEFAULT false,
  model         VARCHAR(80),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  error         TEXT,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
