# Operational metrics

The Stellar listener writes metric records as structured log lines. The current
low-cardinality names are:

| Metric | Value | Labels |
| --- | --- | --- |
| `stellar.listener.poll_lag_ledgers` | Latest ledger minus last processed ledger | None |
| `stellar.rpc.request.duration_ms` | Soroban RPC request duration | `provider` (`soroban`), `result` (`success` or `error`) |
| `escrow.transition.total` | Processed transition count | `event` (the finite escrow event type), `result` (`success`) |

Do not add contract IDs, order IDs, wallet addresses, or transaction hashes as
metric labels. Log aggregation can extract the `metric`, `value`, and `labels`
fields from each JSON line.
