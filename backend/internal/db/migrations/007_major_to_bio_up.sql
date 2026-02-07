DO $$
BEGIN
  -- Prefer renaming existing column to keep data.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'major'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'bio'
  ) THEN
    EXECUTE 'ALTER TABLE users RENAME COLUMN major TO bio';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'bio'
  ) THEN
    EXECUTE 'ALTER TABLE users ADD COLUMN bio TEXT';
  END IF;
END $$;

