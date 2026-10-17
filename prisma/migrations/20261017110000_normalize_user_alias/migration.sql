ALTER TABLE "app_user" ADD COLUMN "alias_normalized" TEXT;

-- Abort with a clear message rather than silently choosing an owner when old
-- aliases collide after Unicode compatibility normalization and case folding.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "app_user"
    WHERE "alias" IS NOT NULL
    GROUP BY lower(normalize("alias", NFKC))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existing aliases collide after NFKC normalization and case folding; resolve collisions before migrating';
  END IF;
END $$;

UPDATE "app_user"
SET "alias_normalized" = lower(normalize("alias", NFKC))
WHERE "alias" IS NOT NULL;

CREATE UNIQUE INDEX "app_user_alias_normalized_key"
  ON "app_user"("alias_normalized");
