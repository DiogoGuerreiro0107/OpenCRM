import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const client = new S3Client({
  endpoint: `${process.env.MINIO_USE_SSL === "true" ? "https" : "http"}://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
});

const bucket = process.env.MINIO_BUCKET ?? "email-attachments";

export async function uploadAttachment(storageKey, buffer, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
    }),
  );
}
