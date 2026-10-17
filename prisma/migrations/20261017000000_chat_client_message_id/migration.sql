ALTER TABLE "chatmessage" ADD COLUMN "client_message_id" UUID;

CREATE UNIQUE INDEX "chatmessage_order_id_sender_id_client_message_id_key"
ON "chatmessage"("order_id", "sender_id", "client_message_id");
