# Evidence retention

Evidence for released, cancelled, and expired orders is retained for 365 days
from upload by default. `EVIDENCE_RETENTION_DAYS` can override the period. The
scheduled cleanup runs daily at 02:00 and removes the stored object before
clearing its URL and upload timestamp from the escrow record. Existing evidence
without a recorded upload date starts a full retention period when the migration
is applied.

Cleanup writes an `EVIDENCE_DELETED` audit record containing the escrow ID and
retention reason only. It does not include the receipt URL or file contents.
Evidence for an order that is still active or disputed is retained until that
order reaches a terminal state.
