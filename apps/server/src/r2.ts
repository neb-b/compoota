import { createReadStream } from "node:fs";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "./config.js";

export type LocalMediaForUpload = {
  id: string;
  deviceId: string;
  path: string;
  mimeType: string;
  extension: string;
};

export type R2UploadResult = {
  bucket: string;
  key: string;
  remoteUrl: string | null;
  uploadedAt: string;
};

export function isR2Configured(config: Config): boolean {
  return Boolean(
      config.r2AccountId &&
      config.r2AccessKeyId &&
      config.r2SecretAccessKey &&
      config.r2Bucket
  );
}

function r2Client(config: Config): S3Client {
  if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
    throw new Error("Cloudflare R2 is not configured.");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey
    }
  });
}

function isR2ApiEndpoint(value: string): boolean {
  try {
    return new URL(value).hostname.endsWith(".r2.cloudflarestorage.com");
  } catch {
    return false;
  }
}

function publicUrl(config: Config, key: string): string | null {
  if (!config.r2PublicBaseUrl) {
    return null;
  }
  if (isR2ApiEndpoint(config.r2PublicBaseUrl)) {
    return null;
  }
  return `${config.r2PublicBaseUrl.replace(/\/+$/, "")}/${key}`;
}

export async function signedR2ReadUrl(config: Config, bucket: string, key: string): Promise<string> {
  return getSignedUrl(
    r2Client(config),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }),
    { expiresIn: config.r2SignedUrlTtlSeconds }
  );
}

export async function mediaReadUrl(config: Config, bucket: string, key: string): Promise<string> {
  return publicUrl(config, key) ?? signedR2ReadUrl(config, bucket, key);
}

export async function uploadMediaToR2(config: Config, media: LocalMediaForUpload): Promise<R2UploadResult | null> {
  if (!isR2Configured(config)) {
    return null;
  }

  const bucket = config.r2Bucket as string;
  const key = `${config.r2KeyPrefix}/${media.deviceId}/${media.id}.${media.extension}`;

  await r2Client(config).send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(media.path),
      ContentType: media.mimeType
    })
  );

  return {
    bucket,
    key,
    remoteUrl: publicUrl(config, key),
    uploadedAt: new Date().toISOString()
  };
}
