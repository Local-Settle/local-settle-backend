ALTER TABLE "escrowonchain"
  ADD COLUMN "last_sync_tx_hash" TEXT,
  ADD COLUMN "last_sync_action" TEXT;

CREATE UNIQUE INDEX "escrowonchain_last_sync_tx_hash_key"
  ON "escrowonchain"("last_sync_tx_hash");
