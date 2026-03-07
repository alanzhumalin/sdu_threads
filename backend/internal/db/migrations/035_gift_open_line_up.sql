ALTER TABLE gift_cards
    ADD COLUMN IF NOT EXISTS open_line TEXT NOT NULL DEFAULT '';

UPDATE gift_cards
SET open_line = CASE
    WHEN lower(ui_language) = 'ru' THEN 'С 8 марта'
    WHEN lower(ui_language) = 'en' THEN 'Happy March 8'
    ELSE '8 наурыз мерекеңізбен'
END
WHERE trim(open_line) = '';
