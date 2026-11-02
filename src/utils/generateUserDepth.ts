/**
 * Pure In-Browser Non-Linear Guided Depth Map & AI Silhouette Segmentation Pipeline
 * Matching scripts/generate_depth.py architecture.
 *
 * Packs 4 channels:
 *   R: Non-linear blended depth relief (near_final)
 *   G: Guided filter depth (near_it)
 *   B: Edge gradient map (edge_grad = min(1, 3.5 * hypot(dx, dy)))
 *   A: Silhouette cutout alpha (cut_alpha)
 */

export interface GeneratedPortraitAssets {
  imageSrc: string;
  depthSrc: string;
  width: number;
  height: number;
}

// Fast separable 2D box blur with O(W * H) running sum
function boxblur(t: Float32Array, w: number, h: number, rad: number): Float32Array {
  const a = new Float32Array(w * h);
  const res = new Float32Array(w * h);
  rad = Math.max(1, Math.min(rad, Math.min(w, h) - 1));

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const yOff = y * w;
    let sum = 0;
    let count = 0;

    for (let x = 0; x <= Math.min(w - 1, rad); x++) {
      sum += t[yOff + x];
      count++;
    }

    for (let x = 0; x < w; x++) {
      if (x + rad < w && x > 0) {
        sum += t[yOff + x + rad];
        count++;
      }
      if (x - rad - 1 >= 0) {
        sum -= t[yOff + x - rad - 1];
        count--;
      }
      a[yOff + x] = sum / count;
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let count = 0;

    for (let y = 0; y <= Math.min(h - 1, rad); y++) {
      sum += a[y * w + x];
      count++;
    }

    for (let y = 0; y < h; y++) {
      if (y + rad < h && y > 0) {
        sum += a[(y + rad) * w + x];
        count++;
      }
      if (y - rad - 1 >= 0) {
        sum -= a[(y - rad - 1) * w + x];
        count--;
      }
      res[y * w + x] = sum / count;
    }
  }

  return res;
}

// 1st-to-99th percentile normalization
function nt(arr: Float32Array): Float32Array {
  const n = arr.length;
  const sampleSize = Math.min(n, 10000);
  const samples = new Float32Array(sampleSize);
  const step = Math.max(1, Math.floor(n / sampleSize));

  for (let i = 0; i < sampleSize; i++) {
    samples[i] = arr[i * step];
  }
  samples.sort();

  const p1 = samples[Math.floor(sampleSize * 0.01)];
  const p99 = samples[Math.floor(sampleSize * 0.99)];
  const range = Math.max(1e-6, p99 - p1);

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(0.0, Math.min(1.0, (arr[i] - p1) / range));
  }
  return out;
}

// Bilinear resize between two Float32Array grids
function resizeFloatGrid(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): Float32Array {
  const dst = new Float32Array(dw * dh);
  const xRatio = (sw - 1) / Math.max(1, dw - 1);
  const yRatio = (sh - 1) / Math.max(1, dh - 1);

  for (let y = 0; y < dh; y++) {
    const srcY = y * yRatio;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(sh - 1, y0 + 1);
    const dy = srcY - y0;

    for (let x = 0; x < dw; x++) {
      const srcX = x * xRatio;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(sw - 1, x0 + 1);
      const dx = srcX - x0;

      const p00 = src[y0 * sw + x0];
      const p10 = src[y0 * sw + x1];
      const p01 = src[y1 * sw + x0];
      const p11 = src[y1 * sw + x1];

      dst[y * dw + x] =
        (1 - dx) * (1 - dy) * p00 +
        dx * (1 - dy) * p10 +
        (1 - dx) * dy * p01 +
        dx * dy * p11;
    }
  }
  return dst;
}

// FastDepth ONNX inference with real RGB image inputs matching generate_depth.py
async function inferDepthMap(
  canvas: HTMLCanvasElement,
  lum: Float32Array,
  w: number,
  h: number,
  onProgress?: (status: string) => void
): Promise<Float32Array> {
  try {
    onProgress?.('LOADING DEPTH MODEL...');
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;

    const modelResp = await fetch('/models/fastdepth.onnx');
    if (!modelResp.ok) throw new Error('FastDepth model not found');
    const modelBuffer = await modelResp.arrayBuffer();

    onProgress?.('RUNNING NEURAL DEPTH...');
    const session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
    });

    const netSize = 224;
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = netSize;
    smallCanvas.height = netSize;
    const sCtx = smallCanvas.getContext('2d');
    if (!sCtx) throw new Error('No 2D context for depth resize');

    sCtx.drawImage(canvas, 0, 0, netSize, netSize);
    const sData = sCtx.getImageData(0, 0, netSize, netSize).data;

    // FastDepth expects RGB in [0, 1] matching scripts/generate_depth.py
    const plane = netSize * netSize;
    const inputData = new Float32Array(1 * 3 * plane);

    for (let i = 0; i < plane; i++) {
      const i4 = i * 4;
      inputData[i] = sData[i4] / 255.0; // R
      inputData[plane + i] = sData[i4 + 1] / 255.0; // G
      inputData[2 * plane + i] = sData[i4 + 2] / 255.0; // B
    }

    const tensor = new ort.Tensor('float32', inputData, [1, 3, netSize, netSize]);
    const feeds: Record<string, any> = {};
    feeds[session.inputNames[0]] = tensor;

    const results = await session.run(feeds);
    const outputTensor = results[session.outputNames[0]];
    const rawOut = outputTensor.data as Float32Array;

    const eNear = new Float32Array(plane);
    for (let i = 0; i < plane; i++) {
      eNear[i] = 1.0 / Math.max(0.05, rawOut[i]);
    }

    // Suppress left-border conv padding ramp matching generate_depth.py
    for (let x = 0; x < 75; x++) {
      const tb = x / 75.0;
      for (let y = 0; y < netSize; y++) {
        const idxL = y * netSize + x;
        const idxRef = y * netSize + 75;
        const idxR = y * netSize + (netSize - 1 - x);
        eNear[idxL] = eNear[idxRef] * (1.0 - tb * 0.4) + eNear[idxR] * (tb * 0.4);
      }
    }

    return resizeFloatGrid(eNear, netSize, netSize, w, h);
  } catch (err) {
    console.warn('FastDepth neural inference fallback to spatial facial relief:', err);
    // Smooth anatomical facial relief fallback (highlights on nose, brow, chin, cheeks)
    const radA = Math.max(2, Math.round(Math.max(w, h) / 24));
    const radB = Math.max(2, Math.round(Math.max(w, h) / 48));
    const smoothWide = boxblur(lum, w, h, radA);
    const smoothTight = boxblur(lum, w, h, radB);

    const fallback = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const ny = y / h;
      const vertPrior = 0.20 * Math.sin(Math.PI * Math.min(1.0, ny * 1.25));
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const nx = (x / w) * 2.0 - 1.0;
        const horizPrior = 0.16 * Math.max(0, 1.0 - nx * nx);
        fallback[idx] =
          0.50 * smoothTight[idx] +
          0.30 * smoothWide[idx] +
          0.20 * lum[idx] +
          vertPrior +
          horizPrior;
      }
    }
    return nt(fallback);
  }
}

// AI Person / Portrait Silhouette Segmentation using MediaPipe Tasks Vision
async function segmentPortrait(
  canvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
  onProgress?: (status: string) => void
): Promise<Float32Array | null> {
  try {
    onProgress?.('ISOLATING PORTRAIT SUBJECT...');
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    const segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: '/models/selfie_segmenter.tflite',
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
    });

    const result = segmenter.segment(canvas);
    const maskObj = result.confidenceMasks?.[0];
    if (!maskObj) return null;

    const maskW = maskObj.width;
    const maskH = maskObj.height;
    const rawMask = maskObj.getAsFloat32Array();

    return resizeFloatGrid(rawMask, maskW, maskH, targetW, targetH);
  } catch (err) {
    console.warn('MediaPipe segmentation unavailable, using robust portrait frame prior:', err);
    return null;
  }
}

/**
 * Generate 3D Particle Depth assets from any user image file.
 */
export async function generateUserPortraitDepth(
  file: File | Blob,
  onProgress?: (status: string) => void
): Promise<GeneratedPortraitAssets> {
  onProgress?.('DECODING IMAGE...');

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image file.'));
    img.src = objectUrl;
  });

  // Preserve the exact native aspect ratio with ZERO cropping
  const origW = img.naturalWidth;
  const origH = img.naturalHeight;
  const assetRatio = origW / origH;

  // Standardize the working resolution so the longest dimension is 1024px (or up to 1536px for tall portraits)
  let targetW: number;
  let targetH: number;

  if (assetRatio >= 1) {
    // Landscape or square (e.g. logos, widescreen photos): width is 1024, height scales proportionally
    targetW = 1024;
    targetH = Math.max(256, Math.min(1024, Math.round(1024 / assetRatio)));
  } else {
    // Portrait (e.g. phone camera portraits): height up to 1536, width scales proportionally
    targetH = Math.min(1536, Math.round(1024 / assetRatio));
    targetW = Math.round(targetH * assetRatio);
    if (targetW > 1024) {
      targetW = 1024;
      targetH = Math.round(1024 / assetRatio);
    }
  }

  const inCanvas = document.createElement('canvas');
  inCanvas.width = targetW;
  inCanvas.height = targetH;
  const inCtx = inCanvas.getContext('2d', { willReadFrequently: true });
  if (!inCtx) throw new Error('Could not create 2D canvas context.');

  inCtx.clearRect(0, 0, targetW, targetH);
  inCtx.drawImage(img, 0, 0, targetW, targetH);
  URL.revokeObjectURL(objectUrl);

  const imgData = inCtx.getImageData(0, 0, targetW, targetH);
  const rgba = imgData.data;
  const totalPixels = targetW * targetH;

  onProgress?.('COMPUTING LUMINANCE RELIEF...');

  const lum = new Float32Array(totalPixels);
  let hasNativeTransparency = false;

  for (let i = 0; i < totalPixels; i++) {
    const i4 = i * 4;
    const r = rgba[i4] / 255.0;
    const g = rgba[i4 + 1] / 255.0;
    const b = rgba[i4 + 2] / 255.0;
    const a = rgba[i4 + 3];

    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (a < 240) {
      hasNativeTransparency = true;
    }
  }

  // 1. Multi-scale luminance relief
  const radRt = Math.max(2, Math.round(Math.max(targetW, targetH) / 36));
  const rRt = boxblur(boxblur(lum, targetW, targetH, radRt), targetW, targetH, radRt);
  const nearRt = nt(
    (() => {
      const out = new Float32Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        out[i] = 0.7 * rRt[i] + 0.3 * lum[i];
      }
      return out;
    })()
  );

  // 2. Neural FastDepth Inference on real RGB canvas
  const eNear = await inferDepthMap(inCanvas, lum, targetW, targetH, onProgress);

  onProgress?.('APPLYING GUIDED FILTER...');

  // 3. Guided Image Filter it()
  const s = Math.max(8, Math.round(targetW / 4));
  const l = Math.max(8, Math.round(targetH / 4));
  const c = Math.max(2, Math.round(Math.max(s, l) / 40));

  const uArr = resizeFloatGrid(lum, targetW, targetH, s, l);
  const hArr = nt(resizeFloatGrid(eNear, targetW, targetH, s, l));

  const pArr = boxblur(uArr, s, l, c);
  const gArr = boxblur(hArr, s, l, c);

  const uSq = new Float32Array(s * l);
  const uH = new Float32Array(s * l);
  for (let i = 0; i < s * l; i++) {
    uSq[i] = uArr[i] * uArr[i];
    uH[i] = uArr[i] * hArr[i];
  }

  const yArr = boxblur(uSq, s, l, c);
  const xArr = boxblur(uH, s, l, c);

  const wCoeff = new Float32Array(s * l);
  const vCoeff = new Float32Array(s * l);
  for (let i = 0; i < s * l; i++) {
    const denom = yArr[i] - pArr[i] * pArr[i] + 0.0015;
    const wVal = (xArr[i] - pArr[i] * gArr[i]) / denom;
    wCoeff[i] = wVal;
    vCoeff[i] = gArr[i] - wVal * pArr[i];
  }

  const mGuide = resizeFloatGrid(boxblur(wCoeff, s, l, c), s, l, targetW, targetH);
  const bGuide = resizeFloatGrid(boxblur(vCoeff, s, l, c), s, l, targetW, targetH);

  const nearItRaw = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    nearItRaw[i] = mGuide[i] * lum[i] + bGuide[i];
  }
  const nearIt = nt(nearItRaw);

  // 4. Blend 0.65 * nearIt + 0.35 * nearRt
  const nearBase = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    nearBase[i] = 0.65 * nearIt[i] + 0.35 * nearRt[i];
  }

  // 5. Accurate Subject Silhouette Cutout Mask
  const cutAlpha = new Uint8Array(totalPixels);

  if (hasNativeTransparency) {
    // Transparent PNG cutout uploaded by user
    for (let i = 0; i < totalPixels; i++) {
      cutAlpha[i] = rgba[i * 4 + 3];
    }
  } else {
    // Try AI portrait segmentation first
    const aiMask = await segmentPortrait(inCanvas, targetW, targetH, onProgress);

    if (aiMask) {
      // Clean sigmoid cut: foreground gets full 255, background gets 0
      for (let i = 0; i < totalPixels; i++) {
        const conf = aiMask[i];
        // Crisp threshold with subtle 0.15 transition at boundary
        const aVal = Math.max(0.0, Math.min(1.0, (conf - 0.22) / 0.28));
        cutAlpha[i] = Math.round(aVal * 255.0);
      }
    } else {
      // Safe portrait frame fallback:
      // Preserves 100% of the person (head, forehead, chest, shoulders) with ZERO holes
      for (let y = 0; y < targetH; y++) {
        // Soft margin fade only at the absolute left/right edges
        for (let x = 0; x < targetW; x++) {
          const idx = y * targetW + x;
          const edgeDistX = Math.min(x, targetW - 1 - x) / (targetW * 0.08);
          const edgeDistY = Math.min(y, targetH - 1 - y) / (targetH * 0.04);
          const boundFade = Math.max(0.0, Math.min(1.0, Math.min(edgeDistX, edgeDistY)));
          cutAlpha[idx] = Math.round(boundFade * 255.0);
        }
      }
    }
  }

  // 6. Background Ribbon Wave
  const nearFinal = new Float32Array(totalPixels);
  for (let y = 0; y < targetH; y++) {
    const uy = 1.0 - y / targetH;
    for (let x = 0; x < targetW; x++) {
      const idx = y * targetW + x;
      const ux = x / targetW;
      const bgWeight = 1.0 - Math.min(1.0, (cutAlpha[idx] / 255.0) * 1.25);

      const chinLoop =
        0.14 *
        Math.exp(-Math.pow((uy - 0.33) / 0.095, 2)) *
        Math.exp(-Math.pow((ux - 0.5) / 0.45, 2));

      const ribbonWave =
        (0.048 * Math.sin(uy * 17.5 + 0.4) +
          0.028 * Math.cos(uy * 32.0 - 1.1) +
          0.022 * Math.sin(uy * 9.5 + ux * 6.0) +
          chinLoop) *
        Math.max(0.0, Math.min(1.0, (nearBase[idx] - 0.28) / 0.45)) *
        bgWeight;

      nearFinal[idx] = Math.max(0.0, Math.min(1.0, nearBase[idx] + ribbonWave));
    }
  }

  // 7. Edge gradient map (_[a] = min(1, 3.5 * hypot(dx, dy)))
  const edgeGrad = new Float32Array(totalPixels);
  for (let y = 1; y < targetH - 1; y++) {
    const yOff = y * targetW;
    for (let x = 1; x < targetW - 1; x++) {
      const idx = yOff + x;
      const gx = lum[idx + 1] - lum[idx - 1];
      const gy = lum[idx + targetW] - lum[idx - targetW];
      edgeGrad[idx] = Math.min(1.0, 3.5 * Math.hypot(gx, gy));
    }
  }

  onProgress?.('PACKING 3D PARTICLES...');

  // 8. Generate Base Image URL
  // CRITICAL FIX: Keep alpha = 255 on all valid pixels!
  // Never premultiply fractional alpha onto color channels, which causes black spots and darkened skin grains.
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = targetW;
  colorCanvas.height = targetH;
  const colCtx = colorCanvas.getContext('2d');
  if (!colCtx) throw new Error('Could not create color canvas context.');

  const colorImgData = colCtx.createImageData(targetW, targetH);
  for (let i = 0; i < totalPixels; i++) {
    const i4 = i * 4;
    colorImgData.data[i4] = rgba[i4];
    colorImgData.data[i4 + 1] = rgba[i4 + 1];
    colorImgData.data[i4 + 2] = rgba[i4 + 2];
    // Keep fully opaque so RGB is never crushed or premultiplied by canvas
    colorImgData.data[i4 + 3] = cutAlpha[i] > 15 ? 255 : 0;
  }
  colCtx.putImageData(colorImgData, 0, 0);
  const imageSrc = colorCanvas.toDataURL('image/png');

  // 9. Generate 4-Channel Packed Depth Image URL
  // R = nearFinal, G = nearIt, B = edgeGrad, A = cutAlpha
  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = targetW;
  depthCanvas.height = targetH;
  const depthCtx = depthCanvas.getContext('2d');
  if (!depthCtx) throw new Error('Could not create depth canvas context.');

  const depthImgData = depthCtx.createImageData(targetW, targetH);
  for (let i = 0; i < totalPixels; i++) {
    const i4 = i * 4;
    depthImgData.data[i4] = Math.round(nearFinal[i] * 255.0);
    depthImgData.data[i4 + 1] = Math.round(nearIt[i] * 255.0);
    depthImgData.data[i4 + 2] = Math.round(edgeGrad[i] * 255.0);
    depthImgData.data[i4 + 3] = cutAlpha[i];
  }
  depthCtx.putImageData(depthImgData, 0, 0);
  const depthSrc = depthCanvas.toDataURL('image/png');

  onProgress?.('COMPLETE');

  return {
    imageSrc,
    depthSrc,
    width: targetW,
    height: targetH,
  };
}
