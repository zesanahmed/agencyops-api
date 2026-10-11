import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

let configured = false;

/**
 * Lazily configures and returns the Cloudinary SDK. Throws a plain
 * Error (the caller wraps it as AppError) rather than crashing at
 * app startup — file upload is one optional feature, not core to
 * the app running.
 */
export function getCloudinary(): typeof cloudinary {
  if (!configured) {
    if (!env.cloudinary) {
      throw new Error("Cloudinary is not configured");
    }
    cloudinary.config({
      cloud_name: env.cloudinary.cloudName,
      api_key: env.cloudinary.apiKey,
      api_secret: env.cloudinary.apiSecret,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

/**
 * Streams an in-memory buffer to Cloudinary. Unlike getCloudinary(),
 * a missing configuration becomes a clean 503 AppError rather than a
 * plain Error that would surface as a generic 500.
 */
export async function uploadBufferToCloudinary(
  folder: string,
  buffer: Buffer,
): Promise<{ publicId: string; url: string }> {
  let client: typeof cloudinary;
  try {
    client = getCloudinary();
  } catch {
    throw new AppError("File storage is not configured", 503);
  }

  const result = await new Promise<{ public_id: string; secure_url: string }>(
    (resolve, reject) => {
      const stream = client.uploader.upload_stream(
        { folder, resource_type: "auto" },
        (error, uploaded) => {
          if (error || !uploaded) reject(error ?? new Error("Cloudinary upload failed"));
          else resolve(uploaded);
        },
      );
      stream.end(buffer);
    },
  ).catch(() => {
    throw new AppError("File upload failed", 502);
  });

  return { publicId: result.public_id, url: result.secure_url };
}

/** Best-effort asset removal; never throws. */
export async function destroyCloudinaryAsset(publicId: string): Promise<void> {
  try {
    await getCloudinary().uploader.destroy(publicId);
  } catch {
    // Already gone or storage unavailable — callers still remove their own record.
  }
}
