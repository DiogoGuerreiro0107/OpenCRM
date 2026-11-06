import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly client: S3Client;
  /** Cliente só para assinar links de download: tem de usar o endereço que o BROWSER alcança. */
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>("MINIO_BUCKET") ?? "email-attachments";
    const internalEndpoint = `${this.config.get<string>("MINIO_USE_SSL") === "true" ? "https" : "http"}://${this.config.get<string>("MINIO_ENDPOINT")}:${this.config.get<string>("MINIO_PORT")}`;
    const makeClient = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.config.get<string>("MINIO_ACCESS_KEY")!,
          secretAccessKey: this.config.get<string>("MINIO_SECRET_KEY")!,
        },
      });

    this.client = makeClient(internalEndpoint);
    // Em Docker o backend fala com o MinIO por "minio:9000", que o browser não resolve. MINIO_PUBLIC_URL
    // (ex.: http://192.168.50.10:9000) é o endereço usado nos links de download; sem ele usa-se o interno.
    // O host entra na assinatura do link, por isso não basta trocar o endereço depois de assinar.
    const publicEndpoint = this.config.get<string>("MINIO_PUBLIC_URL")?.replace(/[/]+$/, "");
    this.presignClient = publicEndpoint && publicEndpoint !== internalEndpoint ? makeClient(publicEndpoint) : this.client;
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
    return getSignedUrl(this.presignClient, command, { expiresIn: 300 });
  }

  async upload(storageKey: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: body, ContentType: contentType }),
    );
  }
}
