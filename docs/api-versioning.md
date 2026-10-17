# API versioning and deprecation policy

## Current contract

All existing prefix-free endpoints are version 1, including `/health` and
`/auth/*`. They keep their current URL and response shape. Responses include
`X-API-Version: 1`; this is metadata and does not change request handling.
Additive optional response fields are compatible changes.

## Breaking changes

Any change that removes or renames a field, changes its meaning, or changes
request behavior incompatibly must be introduced under a `/v2` route. New
versions include health and authentication routes under the same prefix (for
example, `/v2/health` and `/v2/auth/challenge`). The existing unversioned
routes remain available as version 1 during migration.

Before retiring a version, publish migration notes and send `Deprecation`,
`Sunset`, and `Link` response headers from the old routes. Keep the old version
available for at least 180 days after the replacement is released. Auth and
health contracts follow the same window; operational health probes can keep
using `/health` until deployment configuration is migrated.

`X-API-Version` is exposed through CORS so independently deployed clients can
record which contract served a response. Contract regression fixtures and tests
are maintained alongside the affected endpoints.
