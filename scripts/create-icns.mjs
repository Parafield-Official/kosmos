import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [inputDirectory, outputPath] = process.argv.slice(2);

if (!inputDirectory || !outputPath) {
  throw new Error("Usage: node scripts/create-icns.mjs <iconset-directory> <output.icns>");
}

const entries = [
  ["icp4", "icon_16x16.png"],
  ["icp5", "icon_32x32.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic08", "icon_256x256.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
];

const resources = await Promise.all(entries.map(async ([type, filename]) => ({
  type,
  data: await readFile(resolve(inputDirectory, filename)),
})));

const length = 8 + resources.reduce((total, { data }) => total + 8 + data.length, 0);
const icon = Buffer.alloc(length);
icon.write("icns", 0, "ascii");
icon.writeUInt32BE(length, 4);

let offset = 8;
for (const { type, data } of resources) {
  icon.write(type, offset, "ascii");
  icon.writeUInt32BE(8 + data.length, offset + 4);
  data.copy(icon, offset + 8);
  offset += 8 + data.length;
}

await writeFile(outputPath, icon);
