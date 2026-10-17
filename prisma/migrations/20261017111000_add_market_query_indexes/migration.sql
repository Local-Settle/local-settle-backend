CREATE INDEX "idx_offer_market_filters"
  ON "offer" ("status", "type", "asset_code", "offer_id");

CREATE INDEX "idx_offer_creator_offer_id"
  ON "offer" ("creator_id", "offer_id");

CREATE INDEX "idx_order_buyer_status_order_id"
  ON "order" ("buyer_id", "order_status", "order_id");

CREATE INDEX "idx_order_seller_status_order_id"
  ON "order" ("seller_id", "order_status", "order_id");

CREATE INDEX "idx_order_offer_order_id"
  ON "order" ("offer_id", "order_id");
