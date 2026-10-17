# Offer reservation lifecycle

An offer has a single outstanding reservation. Creating an order atomically changes `executed` from `false` to `true` only when the offer is still `active`; concurrent order creation therefore cannot reserve it twice. The offer remains in its configured `active`/`paused`/`closed` state, while `executed` signals that it is unavailable for a new order.

Cancelling an eligible order or expiring an order changes the order state and releases the reservation in the same database transaction. A closed or paused offer stays closed or paused after release; only the reservation flag is cleared. Settlement and dispute states do not release capacity automatically.
