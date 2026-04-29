const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { PNG } = require("pngjs");

const root = join(__dirname, "..");
const sourcePng = join(root, "src", "assets", "icons", "appcenter.png");
const sourceIco = join(root, "src", "assets", "icons", "appcenter.ico");
const buildDir = join(root, "build");

mkdirSync(buildDir, { recursive: true });

const source = PNG.sync.read(readFileSync(sourcePng));
const icon512 = resizePng(source, 512);

writeFileSync(join(buildDir, "icon.png"), PNG.sync.write(icon512));
writeFileSync(join(buildDir, "icon.icns"), createIcns(source));
copyFileSync(sourceIco, join(buildDir, "icon.ico"));

function resizePng(sourceImage, size) {
  const output = new PNG({ width: size, height: size });

  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.min(sourceImage.height - 1, Math.floor((y * sourceImage.height) / size));

    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(sourceImage.width - 1, Math.floor((x * sourceImage.width) / size));
      const sourceIndex = (sourceY * sourceImage.width + sourceX) * 4;
      const outputIndex = (y * size + x) * 4;

      output.data[outputIndex] = sourceImage.data[sourceIndex];
      output.data[outputIndex + 1] = sourceImage.data[sourceIndex + 1];
      output.data[outputIndex + 2] = sourceImage.data[sourceIndex + 2];
      output.data[outputIndex + 3] = sourceImage.data[sourceIndex + 3];
    }
  }

  return output;
}

function createIcns(sourceImage) {
  const entries = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ].map(([type, size]) => {
    const png = PNG.sync.write(resizePng(sourceImage, size));
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });

  const length = 8 + entries.reduce((total, entry) => total + entry.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(length, 4);

  return Buffer.concat([header, ...entries], length);
}
