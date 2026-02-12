DROP INDEX IF EXISTS idx_messages_chat_unread;
DROP INDEX IF EXISTS idx_messages_chat_created_at;

DROP TABLE IF EXISTS messages;

DROP INDEX IF EXISTS idx_chat_participants_user;
DROP TABLE IF EXISTS chat_participants;

DROP INDEX IF EXISTS idx_chats_updated_at;
DROP INDEX IF EXISTS uq_chats_direct_key;
DROP TABLE IF EXISTS chats;
