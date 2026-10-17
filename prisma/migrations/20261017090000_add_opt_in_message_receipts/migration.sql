ALTER TABLE "app_user"
ADD COLUMN "message_receipts_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "chatmessage"
ADD COLUMN "delivered_at" TIMESTAMPTZ(6),
ADD COLUMN "read_at" TIMESTAMPTZ(6);
