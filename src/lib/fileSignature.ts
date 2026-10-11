/**
 * Verifies that an uploaded buffer's leading bytes match the MIME type
 * the client claimed. Multer's fileFilter only sees the client-supplied
 * Content-Type, which is trivially spoofable — this is the stronger
 * check for lower-trust uploaders (client portal contacts).
 */

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const CHECKS: Record<string, (buf: Buffer) => boolean> = {
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  "image/gif": (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]),
  "image/webp": (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  "application/pdf": (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]),
  "application/msword": (b) => startsWith(b, OLE),
  "application/vnd.ms-excel": (b) => startsWith(b, OLE),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => startsWith(b, ZIP),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b) => startsWith(b, ZIP),
  // Plain text must not contain NUL bytes (a common binary tell).
  "text/plain": (b) => !b.includes(0),
};

export function fileSignatureMatches(mimeType: string, buffer: Buffer): boolean {
  const check = CHECKS[mimeType];
  // Unknown types are already rejected by the upload filter; fail closed.
  return check ? check(buffer) : false;
}
