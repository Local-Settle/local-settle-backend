# Health endpoint

`GET /health` returns the database check and safe Stellar network diagnostics.
The `stellar.network` field is `testnet` unless `STELLAR_NETWORK=public` is
configured. `horizonHost` and `sorobanHost` contain only the configured URL's
host (or the default service host); URL paths, query parameters, user names,
and passwords are omitted. The diagnostics identify configuration and do not
probe either Stellar service.
