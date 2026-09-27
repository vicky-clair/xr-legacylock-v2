"use strict";
// Reproducible code-native lock glyph. No image conversion dependency at runtime.
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const size = 32,
  raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    let color = [0, 0, 0, 0];
    if (x >= 2 && x <= 29 && y >= 2 && y <= 29) color = [13, 25, 48, 255];
    if (
      x >= 4 &&
      x <= 27 &&
      y >= 4 &&
      y <= 27 &&
      (x === 4 || x === 27 || y === 4 || y === 27)
    )
      color = [34, 211, 238, 255];
    const distance = Math.hypot(x - 15.5, y - 12);
    if (y <= 13 && distance >= 5 && distance <= 7) color = [226, 248, 255, 255];
    if ((x === 9 || x === 10 || x === 21 || x === 22) && y >= 11 && y <= 17)
      color = [226, 248, 255, 255];
    if (x >= 8 && x <= 23 && y >= 15 && y <= 25) color = [34, 211, 238, 255];
    if (
      Math.hypot(x - 15.5, y - 19) <= 2 ||
      (x >= 15 && x <= 16 && y >= 19 && y <= 23)
    )
      color = [13, 25, 48, 255];
    raw.set(color, offset);
  }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, "../electron/tray-icon.png"), png);
console.log("Generated valid 32x32 RGBA tray glyph (" + png.length + " bytes)");
