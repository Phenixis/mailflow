-- Tags belong to the email, not to a row of the messages table.
--
-- MailFlow gives a message a new row id when it is trashed (UPDATE ... id = gen_random_uuid()) and when
-- it is moved or archived in bulk (DELETE + reinsert), and a full resync reinserts rows too. Tags
-- keyed by the row id either blocked the trash update (foreign key) or were lost on every move.
-- They are now keyed by the account and the email's Message-ID (the same identity the label copies use),
-- so they follow the email through trash, moves, archive and resyncs. A message without a Message-ID
-- falls back to its row id.

CREATE OR REPLACE FUNCTION tag_email_key(message_id TEXT, row_id UUID) RETURNS TEXT
  LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(NULLIF(message_id, ''), 'row:' || row_id::text) $$;

ALTER TABLE message_tags
  ADD COLUMN IF NOT EXISTS account_id  UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS email_key   TEXT,
  -- Set when no message with this key exists any more (permanently deleted); the row is removed after
  -- a grace period, and the mark cleared if the email comes back (a move is delete + insert).
  ADD COLUMN IF NOT EXISTS orphaned_at TIMESTAMPTZ;

-- Carry the existing tags over (only while the old row-id column is still there).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'message_tags' AND column_name = 'message_id') THEN
    UPDATE message_tags mt
       SET account_id = m.account_id, email_key = tag_email_key(m.message_id, m.id)
      FROM messages m
     WHERE m.id = mt.message_id;
    DELETE FROM message_tags WHERE account_id IS NULL;
    -- Two copies of one email carried the same tag: keep one.
    DELETE FROM message_tags a USING message_tags b
     WHERE a.ctid < b.ctid AND a.account_id = b.account_id AND a.email_key = b.email_key AND a.tag_id = b.tag_id;
    ALTER TABLE message_tags DROP CONSTRAINT IF EXISTS message_tags_pkey;
    ALTER TABLE message_tags DROP COLUMN message_id;
    ALTER TABLE message_tags ALTER COLUMN account_id SET NOT NULL, ALTER COLUMN email_key SET NOT NULL;
    ALTER TABLE message_tags ADD PRIMARY KEY (account_id, email_key, tag_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_message_tags_orphaned ON message_tags (orphaned_at) WHERE orphaned_at IS NOT NULL;
