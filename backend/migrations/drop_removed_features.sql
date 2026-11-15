-- Optional cleanup for removed features: friends, chat sharing, the admin
-- console, and the old image store (images table, messages.image_ids and
-- messages.hidden_context).
--
-- The application no longer reads any of this, so leaving it in place is
-- harmless. Run this only when you are certain you do not want the data back:
-- it is irreversible and deletes every friendship, share, audit record,
-- per-role setting, and stored image record.
--
--   psql "$DATABASE_URL" -f migrations/drop_removed_features.sql

BEGIN;

DROP TABLE IF EXISTS shared_chats;
DROP TABLE IF EXISTS friendships;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS images;

ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;

ALTER TABLE messages DROP COLUMN IF EXISTS image_ids;
ALTER TABLE messages DROP COLUMN IF EXISTS hidden_context;

COMMIT;
