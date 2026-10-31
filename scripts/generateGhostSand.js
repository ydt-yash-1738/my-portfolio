import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, '../public/portrait-base-cutout.png');
const outputPath = path.join(__dirname, '../src/assets/ghostSandData.json');

console.log('Reading:', inputPath);
const buf = fs.readFileSync(inputPath);

let pos = 8;
const idatChunks = [];
let width = 0, height = 0;

while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  if (type === 'IHDR') {
    width = buf.readUInt32BE(pos + 8);
    height = buf.readUInt32BE(pos + 12);
  } else if (type === 'IDAT') {
    idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
  }
  pos += 12 + len;
}

const idat = Buffer.concat(idatChunks);
const raw = zlib.inflateSync(idat);

const bpp = 4;
const rowSize = 1 + width * bpp;
const uncompressed = Buffer.alloc(width * height * bpp);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

for (let y = 0; y < height; y++) {
  const filter = raw[y * rowSize];
  const rowStart = y * rowSize + 1;
  const prevRowOut = (y - 1) * width * bpp;
  const currRowOut = y * width * bpp;

  for (let x = 0; x < width * bpp; x++) {
    const rawVal = raw[rowStart + x];
    const left = x >= bpp ? uncompressed[currRowOut + x - bpp] : 0;
    const up = y > 0 ? uncompressed[prevRowOut + x] : 0;
    const upLeft = y > 0 && x >= bpp ? uncompressed[prevRowOut + x - bpp] : 0;

    let val = 0;
    if (filter === 0) val = rawVal;
    else if (filter === 1) val = (rawVal + left) & 0xff;
    else if (filter === 2) val = (rawVal + up) & 0xff;
    else if (filter === 3) val = (rawVal + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) val = (rawVal + paeth(left, up, upLeft)) & 0xff;

    uncompressed[currRowOut + x] = val;
  }
}

console.log('Uncompressed image successfully. Sampling particles...');

// Downsample grid (higher resolution for fine sand grains)
const targetW = 240;
const targetH = 363;
const scaleX = width / targetW;
const scaleY = height / targetH;

// Proportions in original image (1536 x 2324):
// Face center: X = 768
// Forehead: Y = 560
// Eyes: Y = 740
// Nose: Y = 840
// Mouth: Y = 940
// Chin: Y = 1080
// Scarf bounds: Y = 800 to 1350, X = 460 to 1080

const worldHeight = 3.6;
const worldWidth = worldHeight * (targetW / targetH);

const positions = [];
const colors = [];
const sizes = [];
const phases = [];
const speeds = [];

for (let ty = 0; ty < targetH; ty++) {
  for (let tx = 0; tx < targetW; tx++) {
    const origX = Math.floor(tx * scaleX);
    const origY = Math.floor(ty * scaleY);
    const idx = (origY * width + origX) * 4;

    const r = uncompressed[idx];
    const g = uncompressed[idx + 1];
    const b = uncompressed[idx + 2];
    const a = uncompressed[idx + 3];

    if (a < 35) continue; // Skip transparent background

    // Center 3D coordinates
    const nx = (tx / targetW - 0.5) * worldWidth;
    const ny = -(ty / targetH - 0.5) * worldHeight - 0.15;

    const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    const distFromCenter = Math.abs((tx - targetW * 0.5) / (targetW * 0.5));
    const depthZ = brightness * 0.35 - distFromCenter * 0.25;

    // Check if point falls on Ghost Scarf
    // In original: Y from 800 to 1350, X from 460 to 1080
    const isScarfArea = origY >= 820 && origY <= 1380 && Math.abs(origX - 768) < (origY < 1080 ? 280 : 360);

    // Stencil teeth bounds: Y from 920 to 1080, X from 620 to 916
    let isGhostTeeth = false;
    let isNoseAperture = false;

    if (isScarfArea) {
      // Nasal cavity aperture
      if (origY >= 820 && origY <= 880 && Math.abs(origX - 768) < 35) {
        isNoseAperture = true;
      }
      // Teeth slits
      if (origY >= 930 && origY <= 1040) {
        const teethDist = Math.abs(origX - 768);
        if (teethDist < 160) {
          // Vertical slit pattern
          const mod = teethDist % 32;
          if (mod >= 6 && mod <= 24) {
            isGhostTeeth = true;
          }
        }
      }
    }

    // Check if point falls on Combat Battle Scar (Across left eyebrow down to cheek)
    // Left eye is around origX = 660, origY = 680 to 860
    const distToScar1 = Math.abs(origX - (660 - (origY - 700) * 0.2));
    const isScar1 = origY >= 640 && origY <= 840 && distToScar1 < 14;

    // Right temple scratch
    const distToScar2 = Math.abs(origX - (880 + (origY - 720) * 0.4));
    const isScar2 = origY >= 700 && origY <= 780 && distToScar2 < 12;

    let cr, cg, cb;

    if (isNoseAperture) {
      // Hollow nasal cavity
      cr = 0.01;
      cg = 0.05;
      cb = 0.02;
    } else if (isScar1 || isScar2) {
      // Intense combat laceration with phosphor green edges
      cr = 0.95;
      cg = 0.20;
      cb = 0.25;
    } else if (isGhostTeeth) {
      // Luminous painted Ghost skull teeth
      cr = 0.75;
      cg = 1.0;
      cb = 0.85;
    } else if (isScarfArea) {
      // Tactical dark cloth balaclava
      cr = 0.03;
      cg = 0.22;
      cb = 0.08;
    } else {
      // Face skin & features in Night Vision Goggles Phosphor Green
      cr = Math.min(1.0, brightness * 0.25);
      cg = Math.min(1.0, brightness * 1.25 + 0.15);
      cb = Math.min(1.0, brightness * 0.45);
    }

    positions.push(Number(nx.toFixed(4)), Number(ny.toFixed(4)), Number(depthZ.toFixed(4)));
    colors.push(Number(cr.toFixed(3)), Number(cg.toFixed(3)), Number(cb.toFixed(3)));
    sizes.push(Number((1.8 + Math.random() * 1.6).toFixed(2)));
    phases.push(Number((Math.random() * Math.PI * 2).toFixed(2)));
    speeds.push(Number((0.8 + Math.random() * 0.8).toFixed(2)));
  }
}

const particleCount = positions.length / 3;
console.log(`Generated ${particleCount} floating sand particles!`);

const data = {
  count: particleCount,
  positions,
  colors,
  sizes,
  phases,
  speeds,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(data));
console.log('Saved to:', outputPath, 'File size:', (fs.statSync(outputPath).size / 1024).toFixed(1), 'KB');
