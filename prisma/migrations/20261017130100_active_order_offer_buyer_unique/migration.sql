-- Prevent concurrent retries from creating multiple open orders for the same buyer and offer.
CREATE UNIQUE INDEX "order_active_offer_buyer_key"
  ON "order"("offer_id", "buyer_id")
  WHERE "order_status" IN ('created', 'locked');
