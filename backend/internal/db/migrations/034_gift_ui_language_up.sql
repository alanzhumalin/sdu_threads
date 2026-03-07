ALTER TABLE gift_cards
    ADD COLUMN IF NOT EXISTS ui_language TEXT NOT NULL DEFAULT 'kk';

UPDATE gift_cards
SET ui_language = 'kk'
WHERE ui_language IS NULL OR trim(ui_language) = '' OR lower(ui_language) NOT IN ('kk', 'ru', 'en');
