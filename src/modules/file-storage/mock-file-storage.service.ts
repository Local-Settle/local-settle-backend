import { Injectable } from '@nestjs/common';
import {
  FileStorageService,
  StoredFile,
  UploadFileInput,
} from './file-storage.service';

@Injectable()
export class MockFileStorageService extends FileStorageService {
  uploadFile(file: UploadFileInput): Promise<StoredFile> {
    const key =
      file.key ??
      (() => {
        const safeName = file.originalname
          .toLowerCase()
          .replace(/[^a-z0-9.-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        const timestamp = Date.now();
        return `profile-images/${timestamp}-${safeName || 'upload'}`;
      })();

    return Promise.resolve({
      key,
      url: `https://mock-storage.ikash.local/${key}`,
    });
  }

  async getSignedDownloadUrl(
    storedUrl: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${storedUrl}?expires=${expires}&signature=mock`;
  }
}
