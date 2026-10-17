import { randomUUID } from 'node:crypto';
import { AppException, ErrorCode } from '../../common/errors';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function createEvidenceObjectKey(
  escrowId: string,
  originalName: string,
  mimeType: string,
): string {
  const extension = MIME_EXTENSIONS[mimeType];
  const name = originalName.trim();
  const suppliedExtension = name.split('.').pop()?.toLowerCase();

  if (
    !extension ||
    !name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.startsWith('.') ||
    suppliedExtension !== extension &&
      !(mimeType === 'image/jpeg' && suppliedExtension === 'jpeg')
  ) {
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      'Evidence filename extension must match its supported MIME type.',
    );
  }

  return `evidence/${escrowId}/${randomUUID()}.${extension}`;
}
