import multer, { MulterError } from "multer";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Memory storage — the buffer goes straight to Cloudinary via a
 * stream, never written to local disk.
 */
const multerSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new AppError(`File type "${file.mimetype}" is not allowed`, 400));
      return;
    }
    cb(null, true);
  },
}).single("file");

/** Translates Multer's own errors (e.g. file-too-large) into the standard AppError/error envelope. */
export function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  multerSingle(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      next(new AppError(`Upload error: ${err.message}`, 400));
      return;
    }
    next(err);
  });
}
