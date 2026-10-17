# API error responses

The API returns errors using one stable JSON envelope:

```json
{
  "statusCode": 404,
  "error": "ORDER_NOT_FOUND",
  "message": "Order was not found"
}
```

`statusCode` is the HTTP status, `error` is a stable machine-readable code, and
`message` is display text that may change. Clients should branch on `error`, not
on message text. The complete machine-readable list is in
[`api-error-codes.json`](./api-error-codes.json); the source enum is
[`ErrorCode`](../src/common/errors/error-codes.enum.ts).

Unexpected exceptions are logged server-side and return `INTERNAL_SERVER_ERROR`
with a generic message. Stack traces and exception details are not returned to
clients. NestJS HTTP exceptions are normalized by the global
`HttpExceptionFilter`; use `AppException` and an `ErrorCode` for expected
provider and domain failures.

Example client handling:

```ts
if (response.error === 'ORDER_NOT_FOUND') {
  // Show the missing-order state.
}
```
