# Chat evidence attachments

Chat messages can reference evidence already uploaded for an escrow. Clients
send the escrow IDs in `attachmentEvidenceIds`; the API stores only those
references, not file bytes or storage URLs. A reference is accepted only when
the escrow has evidence and belongs to the message's order.

New-message events include attachment metadata and a signed download URL that
expires after five minutes. To retrieve fresh links for an older message, call
`GET /chat-messages/:id/attachments` with an authenticated order participant's
session. The endpoint checks order membership again before signing each URL.

Only JPEG, PNG, WebP, and PDF evidence accepted by the escrow upload endpoint
can be linked. The attachment link is recorded in the audit log with its order,
message, file type, and size; the file itself and its URL are not logged.
