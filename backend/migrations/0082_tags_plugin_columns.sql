-- What a tagging plugin needs on top of hand-made tags.
--
--   tag_definitions.key      a stable identity a plugin can address a tag by ('urgent'), independent of
--                            the name the user gave it. NULL for a tag the user made by hand.
--   message_tags.source      'manual' for a tag the user set, or the id of the plugin that applied it
--   message_tags.dismissed   the user took the tag off; the row stays so a plugin cannot put it back
--
-- Written to be re-run safely: an install that ran the fork's earlier tag migrations already has the
-- columns, with key NOT NULL, which would reject a tag made by hand.

ALTER TABLE tag_definitions ADD COLUMN IF NOT EXISTS key VARCHAR(40);
ALTER TABLE tag_definitions ALTER COLUMN key DROP NOT NULL;
-- NULLs never collide, so hand-made tags (no key) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_definitions_user_key ON tag_definitions (user_id, key);

ALTER TABLE message_tags ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'manual';
ALTER TABLE message_tags ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT false;
