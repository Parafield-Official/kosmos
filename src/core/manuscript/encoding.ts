/** UTF-8 by default, with BOM support for manuscripts saved by Windows editors. */
export function decodeManuscriptText(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  return new TextDecoder(encoding).decode(bytes);
}
