export interface StoredFile {
  key: string;
  url: string;
}

export interface UploadFileInput {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
  key?: string;
}

export abstract class FileStorageService {
  abstract uploadFile(file: UploadFileInput): Promise<StoredFile>;
  abstract getSignedDownloadUrl(
    storedUrl: string,
    expiresInSeconds: number,
  ): Promise<string>;
}
