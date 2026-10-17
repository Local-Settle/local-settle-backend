ALTER TABLE "chatmessage"
ADD COLUMN "attachment_refs" JSONB;

ALTER TABLE "escrowonchain"
ADD COLUMN "evidence_file_name" TEXT,
ADD COLUMN "evidence_content_type" TEXT,
ADD COLUMN "evidence_size" INTEGER;
