ALTER TABLE live_rooms
    DROP COLUMN IF EXISTS password_hash;

ALTER TABLE live_rooms
    DROP COLUMN IF EXISTS is_private;
