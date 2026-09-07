import { unzipSync } from "fflate";

/** Enforce budgets before decompression, including metadata/cover previews. */
export function readArchiveEntries(bytes: Uint8Array, include: (name: string) => boolean, {
  maxBytes = 200 * 1024 * 1024,
  maxFiles = 1_000,
}: { maxBytes?: number; maxFiles?: number } = {}): Record<string, Uint8Array> {
  let size = 0;
  let count = 0;
  const entries = unzipSync(bytes, { filter: file => {
    if (!include(file.name.replaceAll("\\", "/"))) return false;
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) {
      throw new Error("Manuscript archive has an invalid uncompressed entry size");
    }
    size += file.originalSize;
    if (++count > maxFiles || size > maxBytes) {
      throw new Error("Manuscript archive is too large or contains too many text entries");
    }
    return true;
  } });
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name.replaceAll("\\", "/"), data]));
}
