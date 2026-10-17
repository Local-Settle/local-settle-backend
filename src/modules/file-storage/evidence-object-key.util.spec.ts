import { createEvidenceObjectKey } from './evidence-object-key.util';

describe('createEvidenceObjectKey', () => {
  it('uses an opaque generated filename for a Unicode name', () => {
    const key = createEvidenceObjectKey('escrow-1', 'résumé.pdf', 'application/pdf');

    expect(key).toMatch(/^evidence\/escrow-1\/[0-9a-f-]{36}\.pdf$/);
    expect(key).not.toContain('résumé');
  });

  it.each(['../proof.pdf', '..\\proof.pdf', 'proof.jpg.exe'])('rejects unsafe or misleading name %s', (name) => {
    expect(() => createEvidenceObjectKey('escrow-1', name, 'image/jpeg')).toThrow();
  });

  it('rejects a MIME and extension mismatch', () => {
    expect(() =>
      createEvidenceObjectKey('escrow-1', 'proof.pdf', 'image/png'),
    ).toThrow('Evidence filename extension must match its supported MIME type.');
  });
});
