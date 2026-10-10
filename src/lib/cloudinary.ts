import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

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
