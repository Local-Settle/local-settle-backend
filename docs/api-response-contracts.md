# Frontend API response fixtures

The fixtures under `src/modules/api-contracts/fixtures` record representative
user, offer, order, escrow, and send-preparation response shapes without calling
Stellar or Trustless Work. The focused Jest contract tests keep the public keys
and nested send-recipient shape explicit when backend response code changes.

When a response field is intentionally changed, update its fixture and the
frontend compatibility note in the same pull request.
