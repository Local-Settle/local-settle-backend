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
  abstract deleteFile(storedUrl: string): Promise<void>;
  abstract uploadFile(file: UploadFileInput): Promise<StoredFile>;
}
