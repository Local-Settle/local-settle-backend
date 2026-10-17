ALTER TABLE "escrowonchain"
ADD COLUMN "evidence_uploaded_at" TIMESTAMPTZ;

-- Give legacy evidence a full retention window because its upload date is unknown.
UPDATE "escrowonchain"
SET "evidence_uploaded_at" = CURRENT_TIMESTAMP
WHERE "evidence_url" IS NOT NULL;
