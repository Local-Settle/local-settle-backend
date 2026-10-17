# Marketplace query indexes

The added indexes follow the filters and sort keys used by offer discovery and
order history repositories. To compare plans on a representative staging copy,
run `EXPLAIN (ANALYZE, BUFFERS)` for the relevant `offer` and `order` SELECTs
before and after applying the migration. Record row counts and query plans when
reviewing deployment performance; plans depend on the staging data distribution.

Rollback: drop `idx_offer_market_filters`, `idx_offer_creator_offer_id`,
`idx_order_buyer_status_order_id`, `idx_order_seller_status_order_id`, and
`idx_order_offer_order_id` with `DROP INDEX` statements.
