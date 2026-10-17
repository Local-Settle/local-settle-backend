import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket, File } from '@google-cloud/storage';
import {
  FileStorageService,
  StoredFile,
  UploadFileInput,
} from './file-storage.service';
import * as crypto from 'node:crypto';

@Injectable()
export class GcsFileStorageService
  extends FileStorageService
  implements OnModuleInit
{
  private readonly logger = new Logger(GcsFileStorageService.name);
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly bucketName: string;
  private readonly publicUrlBase: string;

  constructor(private readonly configService: ConfigService) {
    super();

    this.bucketName = this.configService.get<string>(
      'GCS_BUCKET_NAME',
      'ikash-profile-images',
    );
    const projectId = this.configService.get<string>(
      'GCS_PROJECT_ID',
      'ikash-local',
    );
    const apiEndpoint = this.configService.get<string>('STORAGE_ENDPOINT', '');

    const options: Record<string, unknown> = { projectId };
    if (apiEndpoint) {
      options.apiEndpoint = apiEndpoint;
      this.publicUrlBase = `${apiEndpoint}/${this.bucketName}`;
    } else {
      this.publicUrlBase = `https://storage.googleapis.com/${this.bucketName}`;
    }

    this.storage = new Storage(options);
    this.bucket = this.storage.bucket(this.bucketName);
  }

  async onModuleInit(): Promise<void> {
    try {
      const bucket = this.bucket;
      const [exists] = await bucket.exists();
      if (!exists) {
        await bucket.create();
        this.logger.log(`Created bucket "${this.bucketName}"`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not ensure bucket "${this.bucketName}" exists: ${message}`,
      );
    }
  }

  async deleteFile(storedUrl: string): Promise<void> {
    const prefix = `${this.publicUrlBase}/`;
    if (!storedUrl.startsWith(prefix)) {
      throw new Error('Stored evidence URL is outside the configured bucket');
    }
    const key = decodeURIComponent(storedUrl.slice(prefix.length));
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }

  async uploadFile(file: UploadFileInput): Promise<StoredFile> {
    const key =
      file.key ??
      (() => {
        const safeName = file.originalname
          .toLowerCase()
          .replace(/[^a-z0-9.-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `profile-images/${timestamp}-${random}-${safeName || 'upload'}`;
      })();

    const blob: File = this.bucket.file(key);

    await blob.save(file.buffer, {
      contentType: file.mimetype,
      resumable: false,
    });

    return {
      key,
      url: `${this.publicUrlBase}/${key}`,
    };
  }

}
