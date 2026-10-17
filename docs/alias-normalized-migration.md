# Normalized alias migration

Alias ownership is unique by the NFKC-normalized, lowercase alias key. The
migration checks for existing normalized collisions and stops with an explicit
error so maintainers can resolve the affected accounts before retrying it.

To roll back before new writes depend on the field, remove the unique index and
the `alias_normalized` column, then remove `aliasNormalized` from the Prisma
model. Existing display aliases and their original spellings remain unchanged.
