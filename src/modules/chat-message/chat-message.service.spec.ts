import { ForbiddenException } from '@nestjs/common';
import { ChatMessageRepository } from './chat-message.repository';
import { ChatMessageService } from './chat-message.service';
import { FileStorageService } from '../file-storage/file-storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';

describe('ChatMessageService attachments', () => {
  const repo = {
    findOrderParticipants: jest.fn(),
    findEvidenceForOrder: jest.fn(),
    findMessageOrderAndAttachmentRefs: jest.fn(),
    create: jest.fn(),
  };
  const storage = { getSignedDownloadUrlFromUrl: jest.fn() };
  const audit = { create: jest.fn() };
  const service = new ChatMessageService(
    repo as unknown as ChatMessageRepository,
    storage as unknown as FileStorageService,
    audit as unknown as AuditLogService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('does not issue a download URL to a user outside the order', async () => {
    repo.findOrderParticipants.mockResolvedValue({
      buyerId: 'buyer-id',
      sellerId: 'seller-id',
    });

    await expect(
      service.getSignedAttachmentsForOrder('order-id', 'outsider-id', [
        'escrow-id',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.findEvidenceForOrder).not.toHaveBeenCalled();
    expect(storage.getSignedDownloadUrlFromUrl).not.toHaveBeenCalled();
  });

  it('rejects evidence references that do not belong to the message order', async () => {
    repo.findEvidenceForOrder.mockResolvedValue([]);

    await expect(
      service.createFromChat({
        orderId: 'order-id',
        senderId: 'buyer-id',
        content: 'Payment evidence',
        attachmentEvidenceIds: ['other-order-escrow-id'],
      }),
    ).rejects.toThrow('Evidence must exist on this order');
    expect(repo.create).not.toHaveBeenCalled();
  });
});
