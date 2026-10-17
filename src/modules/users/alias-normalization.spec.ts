import { normalizeAlias } from './alias-normalization';

describe('normalizeAlias', () => {
  it('folds case and compatibility characters into one canonical key', () => {
    expect(normalizeAlias('Alice_1')).toBe('alice_1');
    expect(normalizeAlias('Ａlice_1')).toBe('alice_1');
  });
});
