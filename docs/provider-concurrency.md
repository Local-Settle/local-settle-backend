# Upstream provider concurrency

Horizon requests and Trustless Work requests use separate FIFO queues. Defaults
are five concurrent Horizon requests with up to 25 waiting, and three
concurrent Trustless Work requests with up to 15 waiting. Each queue rejects
excess work with HTTP 503 and waiting work that exceeds its timeout with HTTP
504. Queue entries accept an `AbortSignal`; cancelling a queued entry removes
it without running the provider call.

Tune each provider independently with the `*_MAX_CONCURRENT_REQUESTS`,
`*_MAX_QUEUED_REQUESTS`, and `*_QUEUE_TIMEOUT_MS` environment variables.
Horizon transaction submissions and Trustless Work requests use FIFO admission.
