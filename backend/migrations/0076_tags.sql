-- User-defined tags on messages, stored in the database only (nothing is written to IMAP).
--
--   tag_definitions  one row per tag per user: a key (stable identity), a name and a colour
--   message_tags     a tag on a message, with a `source`: 'manual' (set by the user) or the id of the
--                    plugin that applied it. A row the user removed is kept with dismissed = true so
--                    a plugin cannot silently re-apply it.

CREATE TABLE IF NOT EXISTS tag_definitions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        VARCHAR(40) NOT NULL,
  name       VARCHAR(80) NOT NULL,
  color      VARCHAR(9) NOT NULL DEFAULT '#6b7280',
  position   INTEGER NOT NULL DEFAULT 0,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS message_tags (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tag_definitions(id) ON DELETE CASCADE,
  source     VARCHAR(40) NOT NULL DEFAULT 'manual',
  dismissed  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_message_tags_tag ON message_tags (tag_id) WHERE NOT dismissed;
