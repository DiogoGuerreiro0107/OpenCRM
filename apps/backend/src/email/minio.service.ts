import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>("MINIO_BUCKET") ?? "email-attachments";
    this.client = new S3Client({
      endpoint: `${this.config.get<string>("MINIO_USE_SSL") === "true" ? "https" : "http"}://${this.config.get<string>("MINIO_ENDPOINT")}:${this.config.get<string>("MINIO_PORT")}`,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.get<string>("MINIO_ACCESS_KEY")!,
        secretAccessKey: this.config.get<string>("MINIO_SECRET_KEY")!,
      },
    });
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      // Bucket ainda não existe ou MinIO indisponível — não bloqueia o arranque do backend.
    }
  }

  async getDownloadUrl(storageKey: string) {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: storageKey });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  async upload(storageKey: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: body, ContentType: contentType }),
    );
  }
}
