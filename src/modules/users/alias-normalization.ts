export function normalizeAlias(alias: string): string {
  return alias.normalize('NFKC').toLowerCase();
}
