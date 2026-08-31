-- Optional cleanup for the friends / chat-sharing / admin-console removal.
--
-- The application no longer reads any of this, so leaving it in place is
-- harmless. Run this only when you are certain you do not want the data back:
-- it is irreversible and deletes every friendship, share, audit record, and
-- per-role setting.
--
--   psql "$DATABASE_URL" -f migrations/drop_removed_features.sql

BEGIN;

DROP TABLE IF EXISTS shared_chats;
DROP TABLE IF EXISTS friendships;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS feature_flags;

ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
ALTER TABLE users DROP COLUMN IF EXISTS username;

COMMIT;
