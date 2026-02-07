DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'bio'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'major'
  ) THEN
    EXECUTE 'ALTER TABLE users RENAME COLUMN bio TO major';
  END IF;
END $$;

