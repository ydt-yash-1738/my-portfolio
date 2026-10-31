import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export interface ParticleDepthPortraitProps {
  imageSrc?: string;
  depthSrc?: string;
  onClose?: () => void;
  isLocked?: boolean;
}

interface TrackingNodeData {
  id: string;
  nx: number;
  ny: number;
  nz: number;
  basePos: THREE.Vector3;
  currentPos: THREE.Vector3;
  phase: number;
}

interface LampData {
  id: string;
  nx: number;
  ny: number;
  nz: number;
  d: number; // slow decay state (tau = 0.45s)
  r: number; // fast attack state (tau = 0.018s)
  L: number; // normalized current intensity
}

interface BrushWakePoint {
  x: number;
  y: number;
  dx: number;
  dy: number;
  m: number;
  t: number;
}

interface ProjectedMarker {
  id: string;
  x: number;
  y: number;
  text: string;
  visible: boolean;
  alpha: number;
  isLamp?: boolean;
  coreRadiusPx?: number;
}

const RAW_NODES = [
  { id: '01', nx: +0.62, ny: +0.88, nz: +0.34 },
  { id: '06', nx: -0.15, ny: +0.58, nz: -0.10 },
  { id: '02', nx: -0.38, ny: +0.02, nz: +0.13 },
  { id: '08', nx: +0.59, ny: -0.46, nz: -0.14 },
  { id: '03', nx: +0.12, ny: -0.79, nz: +0.10 },
  { id: '05', nx: -0.42, ny: +0.77, nz: -0.21 },
  { id: '10', nx: +0.91, ny: -0.08, nz: -0.05 },
  { id: '09', nx: +0.55, ny: +0.79, nz: +0.06 },
];

// Normalization factor for bi-exponential envelope (tau_decay = 0.45s, tau_rise = 0.018s)
const biExpNorm = (tDecay: number, tRise: number) =>
  Math.pow(tRise / tDecay, tRise / (tDecay - tRise)) -
  Math.pow(tRise / tDecay, tDecay / (tDecay - tRise));

const LAMP_ENV_NORM = biExpNorm(0.45, 0.018);

// Cached 2D Hilbert space-filling curve lookup table (exact W() from gather.be-of-dao.com)
let cachedHilbertGridSize = 0;
let cachedHilbertTable: Uint32Array | null = null;

function getHilbertTable(gridSize: number): Uint32Array {
  if (cachedHilbertTable && cachedHilbertGridSize === gridSize) {
    return cachedHilbertTable;
  }
  const total = gridSize * gridSize;
  const table = new Uint32Array(total);
  for (let idx = 0; idx < total; idx++) {
    let o = idx;
    let x = 0;
    let y = 0;
    for (let step = 1; step < gridSize; step <<= 1) {
      const rx = 1 & (o >> 1);
      const ry = 1 & (o ^ rx);
      if (ry === 0) {
        if (rx === 1) {
          x = step - 1 - x;
          y = step - 1 - y;
        }
        const tmp = x;
        x = y;
        y = tmp;
      }
      x += step * rx;
      y += step * ry;
      o >>= 2;
    }
    table[idx] = y * gridSize + x;
  }
  cachedHilbertGridSize = gridSize;
  cachedHilbertTable = table;
  return table;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export const ParticleDepthPortrait: React.FC<ParticleDepthPortraitProps> = ({
  imageSrc = '/portrait-base-cutout.png',
  depthSrc = '/portrait-depth.png',
  isLocked = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isLockedRef = useRef(isLocked);
  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);
  const [markers, setMarkers] = useState<ProjectedMarker[]>([]);
  const [lampLinks, setLampLinks] = useState<Array<{ x1: number; y1: number; x2: number; y2: number; alpha: number }>>([]);

  const triggerFlashRef = useRef<((strength?: number) => void) | null>(null);

  useEffect(() => {
    const handleFlash = () => {
      if (triggerFlashRef.current) {
        triggerFlashRef.current(1.0);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 's') {
        if (triggerFlashRef.current) {
          triggerFlashRef.current(1.0);
        }
      }
    };

    window.addEventListener('trigger-node-flash', handleFlash);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('trigger-node-flash', handleFlash);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let animFrameId: number;
    let renderer: THREE.WebGLRenderer | null = null;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // ── SCENE & CAMERA ──
    const fov = 34; // Matches gather.be-of-dao.com's tan(17 deg) half-FOV
    const fovRad = (fov * Math.PI) / 180;
    const cameraZ = (height / 2) / Math.tan(fovRad / 2);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050506);

    const camera = new THREE.PerspectiveCamera(fov, width / height, 1, 12000);
    camera.position.set(0, 0, cameraZ);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(dpr);
    container.appendChild(renderer.domElement);

    // ── PORTRAIT GROUP ──
    const portraitGroup = new THREE.Group();
    scene.add(portraitGroup);

    const imgWidth = 1536;
    const imgHeight = 2324;

    const baseScale = Math.min(width / imgWidth, height / imgHeight);
    const zoomFactor = 1.07;
    const scale = baseScale * zoomFactor;
    const planeWidth = imgWidth * scale;
    const planeHeight = imgHeight * scale;
    const bleedBottom = Math.max(36, height * 0.045);
    const posY = -(height / 2) + planeHeight / 2 - bleedBottom;

    portraitGroup.position.set(0, posY, 0);

    // ── 3D TELEMETRY TRACKING NODES ──
    const depthExtrusion = 350.0;
    const trackingNodes: TrackingNodeData[] = RAW_NODES.map((n, i) => ({
      id: n.id,
      nx: n.nx,
      ny: n.ny,
      nz: n.nz,
      basePos: new THREE.Vector3(
        n.nx * (planeWidth * 0.5),
        n.ny * (planeHeight * 0.5),
        n.nz * (depthExtrusion * 0.65)
      ),
      currentPos: new THREE.Vector3(),
      phase: i * 1.35,
    }));

    trackingNodes.forEach((n) => n.currentPos.copy(n.basePos));

    // Subtle proximity links between telemetry nodes
    const lineEdges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [1, 5],
      [5, 7],
    ];

    const linePoints = new Float32Array(lineEdges.length * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePoints, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.055,
      linewidth: 1,
    });
    const lineSegments = new THREE.LineSegments(lineGeo, lineMat);
    portraitGroup.add(lineSegments);

    // ── 3-LAMP POOL (gather.be-of-dao.com's exact At[] & zt() snare/light system) ──
    const lamps: LampData[] = [0, 1, 2].map((idx) => ({
      id: `L${idx + 1}`,
      nx: 0,
      ny: 0,
      nz: 0,
      d: 0,
      r: 0,
      L: 0,
    }));
    let lampCursor = 0;

    triggerFlashRef.current = (strength = 1.0) => {
      const prevLamp = lamps[(lampCursor + 2) % 3];
      const lamp = lamps[lampCursor];
      lampCursor = (lampCursor + 1) % 3;

      let tries = 0;
      do {
        lamp.nx = 0.68 * (2.0 * Math.random() - 1.0);
        lamp.ny = 1.15 * Math.random() - 0.52;
        lamp.nz = 0.75 * (2.0 * Math.random() - 1.0);
      } while (
        Math.hypot(lamp.nx - prevLamp.nx, lamp.ny - prevLamp.ny, lamp.nz - prevLamp.nz) < 0.55 &&
        ++tries < 8
      );

      lamp.d = Math.min(1.35, lamp.d + strength);
      lamp.r = Math.min(1.35, lamp.r + strength);
    };

    // ── HIGH-DENSITY 524,288 PARTICLE CLOUD (gather.be-of-dao.com's bits=19 / 18) ──
    const isMobile = window.innerWidth < 768;
    const totalPoints = isMobile ? 262144 : 524288; // 2^18 on mobile, 2^19 on desktop

    // Normalized [-1, 1] positions: x, y, zNorm
    const positions = new Float32Array(totalPoints * 3);
    // Boosted sRGB grain colors: r, g, b in [0, 1]
    const aCol = new Float32Array(totalPoints * 3);
    // Metadata per grain: x = nearVal, y = isForeground (1 or 0), z = bgRadialMask, w = importance weight
    const aMeta = new Float32Array(totalPoints * 4);
    // Deterministic per-grain random seeds: r1, r2, r3, r4
    const aRandom = new Float32Array(totalPoints * 4);

    // Mulberry32 PRNG matching gather.be-of-dao.com's t(seed)
    const createMulberry32 = (initialSeed: number) => {
      let s = initialSeed | 0;
      return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    const rngInit = createMulberry32(1337);
    for (let i = 0; i < totalPoints; i++) {
      const r4Idx = i * 4;
      aRandom[r4Idx] = rngInit();
      aRandom[r4Idx + 1] = rngInit();
      aRandom[r4Idx + 2] = rngInit();
      aRandom[r4Idx + 3] = rngInit();
    }

    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    const colAttr = new THREE.BufferAttribute(aCol, 3);
    const metaAttr = new THREE.BufferAttribute(aMeta, 4);
    const randAttr = new THREE.BufferAttribute(aRandom, 4);

    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('aCol', colAttr);
    geometry.setAttribute('aMeta', metaAttr);
    geometry.setAttribute('aRandom', randAttr);

    // Compute gather.be-of-dao.com's exact micro-grain size (k) and energy gain (T)
    const computeSizeAndGain = (curPlaneH: number, curDpr: number) => {
      const b = curPlaneH * 0.56 * curDpr;
      // Ultra-fine sand grains: ~1.25px to 1.65px in device pixels
      const k = Math.max(1.22 * curDpr, Math.min(2.35 * curDpr, b * Math.sqrt(0.6 / totalPoints) * 1.65));
      const E = (totalPoints * (0.35 * k * k)) / (0.6 * b * b);
      const T = Math.max(0.12, Math.min(1.0, 0.68 / (E + 0.12)));
      return { pointSize: k, gain: T };
    };

    const initialMetrics = computeSizeAndGain(planeHeight, dpr);

    // 6-slot pointer wake buffer (gather's uBrush[6])
    const brushUniformArray = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0));

    const uniforms = {
      uTime: { value: 0 },
      uScatter: { value: 1.0 },
      uFade: { value: 0.0 },
      uDepthScale: { value: isMobile ? 280.0 : 380.0 },
      uPlaneSize: { value: new THREE.Vector2(planeWidth, planeHeight) },
      uPointSize: { value: initialMetrics.pointSize },
      uMinPx: { value: 1.0 },
      uGain: { value: initialMetrics.gain },
      uRotY: { value: 0.0 },
      uRotX: { value: 0.0 },
      uAspect: { value: width / height },
      uBurstProgress: { value: 0.0 },
      uBurstCenter: { value: new THREE.Vector2(0.0, 0.0) },
      uCameraZ: { value: cameraZ },
      // 3 simultaneous 3D lamps in normalized [-1, 1] portrait space (xyz = pos, w = intensity L)
      uLamp0: { value: new THREE.Vector4(0, 0, 0, 0) },
      uLamp1: { value: new THREE.Vector4(0, 0, 0, 0) },
      uLamp2: { value: new THREE.Vector4(0, 0, 0, 0) },
      uLampCol: { value: new THREE.Color(0xffe9c4) },
      uLampSum: { value: 0.0 },
      uBrush: { value: brushUniformArray },
    };

    const vertexShader = `
      uniform float uTime;
      uniform float uScatter;
      uniform float uFade;
      uniform float uDepthScale;
      uniform vec2 uPlaneSize;
      uniform float uPointSize;
      uniform float uMinPx;
      uniform float uGain;
      uniform float uRotY;
      uniform float uRotX;
      uniform float uAspect;
      uniform float uBurstProgress;
      uniform vec2 uBurstCenter;
      uniform float uCameraZ;
      uniform vec4 uLamp0;
      uniform vec4 uLamp1;
      uniform vec4 uLamp2;
      uniform vec3 uLampCol;
      uniform float uLampSum;
      uniform vec4 uBrush[6];

      attribute vec3 aCol;
      attribute vec4 aMeta;
      attribute vec4 aRandom;

      varying vec3 vCol;

      // 3D curl-like harmonic flow field from gather.be-of-dao.com
      vec3 flow(vec3 q, float t) {
        return 0.5 * vec3(
          sin(q.y * 2.3 + t) + sin(q.z * 3.1 - t * 0.7 + q.x),
          sin(q.x * 2.7 - t * 0.8) + sin(q.z * 2.9 + t * 0.6 + q.y),
          sin(q.x * 3.3 + t * 0.5) + sin(q.y * 3.7 - t)
        );
      }

      void main() {
        float nearVal = aMeta.x;
        bool isForeground = aMeta.y > 0.5;
        float bgRadialMask = aMeta.z;
        float toneWeight = aMeta.w;

        float r1 = aRandom.x;
        float r2 = aRandom.y;
        float r3 = aRandom.z;
        float r4 = aRandom.w;
        float r5 = fract(r1 * 7.13 + r4 * 13.37);

        // Smooth reveal of the white undulating depth layer only as the portrait rotates toward side profile
        float sideViewFactor = smoothstep(0.16, 0.52, abs(uRotY) + abs(uRotX) * 0.5);

        if (!isForeground) {
          float bgKeepProb = mix(0.03, 0.92, sideViewFactor) * bgRadialMask;
          if (r1 > bgKeepProb) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            vCol = vec3(0.0);
            return;
          }
        }

        // Slow organic breathing (gather.be-of-dao.com's exact uBreath)
        float breathPhase = fract(uTime / 5.6);
        float uBreath = (breathPhase < 0.42
          ? -cos(3.14159265 * breathPhase / 0.42)
          : cos(3.14159265 * (breathPhase - 0.42) / 0.58));

        vec3 p = position;

        // Subtle undulating ribbon wave ONLY on the background depth sheet during side-profile rotation
        if (!isForeground) {
          float bgWave = 0.032 * sin(p.y * 5.2 + uTime * 0.35 + p.x * 1.8)
                       + 0.018 * cos(p.y * 11.4 - uTime * 0.25 - p.x * 2.7);
          p.z += bgWave * sideViewFactor;
        }

        p.xy *= 1.0 + 0.011 * uBreath;
        p.z = p.z * (1.0 + 0.08 * uBreath) + 0.014 * uBreath;

        // The held side barely stirs (exact 0.0035 amplitude from gather.be-of-dao.com)
        p += flow(p * 2.0 + r2 * 3.0, uTime * 0.2) * 0.0035;

        // ── RAGGED NON-LINEAR WIND DRIFT (gather.be-of-dao.com's exact algorithm) ──
        // Drift releases off the right edge (+X) so the entire central face (both eyes, glasses, nose, mouth)
        // stays 100% dense and sharp, matching gather.be-of-dao.com
        float windSign = uRotY < -0.35 ? -1.0 : 1.0;
        vec2 lineNormal = vec2(0.9889 * windSign, -0.1488);
        vec2 lineTangent = vec2(-lineNormal.y, lineNormal.x);
        vec2 lineOrigin = vec2(0.24 * windSign, 0.0);

        float along = dot(p.xy - lineOrigin, lineTangent);
        float ragged = 0.11 * sin(along * 3.1 + uTime * 0.13)
                     + 0.06 * sin(along * 7.7 - uTime * 0.09 + 1.7)
                     + (r5 - 0.5) * 0.34;

        float distFromLine = dot(p.xy - lineOrigin, lineNormal) + ragged;
        float away = smoothstep(0.0, 1.15, distFromLine);

        float alive = 1.0;
        float gone = 0.0;
        float home = 1.0;

        if (away > 0.0) {
          float per = 3.5 + 5.5 * r1;
          float ph = fract(uTime / per + r2);
          float hold = mix(0.82, 0.06, away);
          gone = max(0.0, (ph - hold) / (1.0 - hold));

          float tr = gone * sqrt(gone);
          float windStrength = 1.2;
          float reach = windStrength * 1.8 * away * (0.55 + 0.9 * r3);

          vec3 tb = flow(p * 1.7 + vec3(r4 * 7.0, r1 * 5.0, r3 * 3.0), uTime * 0.3 + ph * 2.5);

          p.xy += lineNormal * reach * tr;
          p += tb * tr * reach * 0.3;
          p.z += (r4 - 0.5) * tr * reach * 0.6;

          alive = mix(
            1.0,
            smoothstep(0.0, 0.07, ph) * (1.0 - smoothstep(0.3, 1.0, gone)),
            smoothstep(0.0, 0.3, away)
          );
          home = (1.0 + 0.6 * away * (1.0 - away) * (1.0 - min(1.0, gone * 6.0))) * (1.0 - 0.6 * away * away);
        }

        // ── 3D LAMP ILLUMINATION ON PARTICLES (gather.be-of-dao.com's exact inverse-square law) ──
        vec3 d0 = p - uLamp0.xyz;
        vec3 d1 = p - uLamp1.xyz;
        vec3 d2 = p - uLamp2.xyz;
        float lit = uLamp0.w / (1.0 + dot(d0, d0) * 3.2)
                  + uLamp1.w / (1.0 + dot(d1, d1) * 3.2)
                  + uLamp2.w / (1.0 + dot(d2, d2) * 3.2);

        // Convert from normalized gather space [-1, 1] to Three.js world space
        vec3 gatheredPos = vec3(
          p.x * (uPlaneSize.x * 0.5),
          p.y * (uPlaneSize.y * 0.5),
          -p.z * uDepthScale
        );

        // Click / touch burst wave
        if (uBurstProgress > 0.0) {
          float dist = length(position.xy - uBurstCenter);
          float wave = sin(clamp((dist * 4.5 - uBurstProgress * 7.0), 0.0, 3.14159));
          gatheredPos += (aRandom.xyz - 0.5) * 2.0 * wave * 135.0;
        }

        // Initial scatter / gather entrance trajectory
        vec3 scatterOffset = vec3(
          (r1 - 0.5) * 1600.0 + sin(uTime * 1.2 + r2 * 6.28) * 60.0,
          (r2 - 0.5) * 1600.0 + cos(uTime * 1.2 + r1 * 6.28) * 60.0,
          (r3 - 0.5) * 1800.0
        );

        vec3 finalPos = mix(gatheredPos, gatheredPos + scatterOffset, uScatter);

        vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
        vec4 cp = projectionMatrix * mvPosition;

        // ── POINTER WAKE ("a hand through smoke" from gather.be-of-dao.com) ──
        vec2 sp = cp.xy / max(cp.w, 0.05);
        vec2 asp = vec2(uAspect, 1.0);
        vec2 push = vec2(0.0);
        for (int b = 0; b < 6; b++) {
          vec2 d = (sp - uBrush[b].xy) * asp;
          vec2 w = uBrush[b].zw;
          push += (w + vec2(-w.y, w.x) * (r2 - 0.5) * 1.3) * exp(-dot(d, d) * 22.0) * (0.45 + 1.1 * r1);
        }
        cp.xy += (push / asp) * cp.w;
        gl_Position = cp;

        float perspectiveScale = uCameraZ / max(-mvPosition.z, 50.0);
        // Exact gather.be-of-dao.com micro-grain size & sub-pixel fade
        float sz = uPointSize * (0.6 + 0.9 * r3) * perspectiveScale * (1.0 - 0.45 * gone) * (1.0 + 0.5 * min(1.0, lit));
        float fade = min(1.0, sz / uMinPx);
        gl_PointSize = max(uMinPx, sz);

        // Grazing-angle normalization so side profile doesn't over-saturate
        float viewGainNorm = isForeground
          ? mix(1.0, 0.58, sideViewFactor * 0.5)
          : mix(0.12, 0.55, sideViewFactor) * bgRadialMask;

        float nearShade = mix(0.55, 1.15, clamp(nearVal, 0.0, 1.0));
        float base = uGain * viewGainNorm * toneWeight * fade * fade * alive * uFade * home;

        // Exact gather.be-of-dao.com light reflection equation:
        vec3 c = aCol * base * nearShade;
        c = c * (1.0 - 0.5 * uLampSum) + mix(aCol, uLampCol, 0.75) * base * lit * 2.7;

        vCol = c;
      }
    `;

    const fragmentShader = `
      varying vec3 vCol;

      void main() {
        float d = length(gl_PointCoord * 2.0 - 1.0);
        if (d > 1.0) discard;

        // Crisp sand-grain radial falloff matching gather.be-of-dao.com
        float a = smoothstep(1.0, 0.3, d);
        gl_FragColor = vec4(vCol * a, a);
      }
    `;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
    });

    const pointsMesh = new THREE.Points(geometry, material);
    pointsMesh.visible = false; // Shown as soon as Hilbert-curve importance sampling completes
    portraitGroup.add(pointsMesh);

    // ── HILBERT-CURVE IMPORTANCE SAMPLING (exact G(e) & W() from gather.be-of-dao.com) ──
    let startTime = performance.now();
    let gatherProgress = 0;
    let isReady = false;

    Promise.all([loadHtmlImage(imageSrc), loadHtmlImage(depthSrc)])
      .then(([baseImg, depthImg]) => {
        if (disposed) return;

        const gridN = 1024;
        const gridShift = 10; // log2(1024)
        const totalCells = gridN * gridN;
        const hilbert = getHilbertTable(gridN);

        const canvas = document.createElement('canvas');
        canvas.width = gridN;
        canvas.height = gridN;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.clearRect(0, 0, gridN, gridN);
        ctx.drawImage(baseImg, 0, 0, gridN, gridN);
        const rgba = ctx.getImageData(0, 0, gridN, gridN).data;

        ctx.clearRect(0, 0, gridN, gridN);
        ctx.drawImage(depthImg, 0, 0, gridN, gridN);
        const depthRgba = ctx.getImageData(0, 0, gridN, gridN).data;

        const lumArr = new Float32Array(totalCells);
        const nearArr = new Float32Array(totalCells);
        const cutArr = new Float32Array(totalCells);
        const cleanR = new Float32Array(totalCells);
        const cleanG = new Float32Array(totalCells);
        const cleanB = new Float32Array(totalCells);

        for (let idx = 0; idx < totalCells; idx++) {
          const i4 = idx * 4;
          cutArr[idx] = depthRgba[i4 + 3] / 255.0;
          nearArr[idx] = depthRgba[i4] / 255.0;
        }

        // Pass 1: Extract raw sRGB colors (no gamma 2.2 crushing!) & suppress silhouette white backdrop fringe
        for (let row = 0; row < gridN; row++) {
          for (let col = 0; col < gridN; col++) {
            const idx = row * gridN + col;
            const cutAlpha = cutArr[idx];

            if (cutAlpha > 0.45) {
              // Check if pixel is within 4px of the cutout edge where white studio backdrop bled into hair/hoodie
              const cL = cutArr[row * gridN + Math.max(0, col - 4)];
              const cR = cutArr[row * gridN + Math.min(gridN - 1, col + 4)];
              const cU = cutArr[Math.max(0, row - 4) * gridN + col];
              const cD = cutArr[Math.min(gridN - 1, row + 4) * gridN + col];
              const isNearSilhouetteEdge = Math.min(cutAlpha, cL, cR, cU, cD) < 0.92;

              let sampleIdx = idx;
              if (isNearSilhouetteEdge) {
                // Step 5px inward toward portrait center so edge grains inherit true hair/skin/hoodie color
                const inCol = Math.max(0, Math.min(gridN - 1, col + (col < 512 ? 5 : -5)));
                const inRow = Math.max(0, Math.min(gridN - 1, row + (row < 620 ? 5 : -5)));
                const candidateIdx = inRow * gridN + inCol;
                if (cutArr[candidateIdx] > 0.9) {
                  sampleIdx = candidateIdx;
                }
              }

              const s4 = sampleIdx * 4;
              const m0 = rgba[s4] / 255.0;
              const m1 = rgba[s4 + 1] / 255.0;
              const m2 = rgba[s4 + 2] / 255.0;

              cleanR[idx] = m0;
              cleanG[idx] = m1;
              cleanB[idx] = m2;
              lumArr[idx] = 0.2126 * m0 + 0.7152 * m1 + 0.0722 * m2;
            }
          }
        }

        // Pass 2: Compute local luminance gradient _[a] and balanced importance density weight B[a]
        const edgeArr = new Float32Array(totalCells);
        const weightArr = new Float32Array(totalCells);
        const bgMaskArr = new Float32Array(totalCells);
        let weightSum = 0;

        for (let row = 0; row < gridN; row++) {
          const ny = 1.0 - ((row + 0.5) / gridN) * 2.0;
          const maskY = Math.max(0.0, Math.min(1.0, (0.98 - Math.abs(ny)) / (0.98 - 0.55)));
          const smoothY = maskY * maskY * (3.0 - 2.0 * maskY);

          for (let col = 0; col < gridN; col++) {
            const idx = row * gridN + col;
            const nx = ((col + 0.5) / gridN) * 2.0 - 1.0;
            const cutAlpha = cutArr[idx];
            const nearVal = nearArr[idx];

            if (cutAlpha > 0.45) {
              const dx =
                lumArr[Math.min(totalCells - 1, idx + 1)] - lumArr[Math.max(0, idx - 1)];
              const dy =
                lumArr[Math.min(totalCells - 1, idx + gridN)] -
                lumArr[Math.max(0, idx - gridN)];
              const edgeGrad = Math.min(1.0, 3.5 * Math.hypot(dx, dy));
              edgeArr[idx] = edgeGrad;

              const h = lumArr[idx];

              // Balanced Hilbert importance weight:
              // - High base floor (0.22) so dark hair, eyebrows, beard & hoodie get dense fine grains
              // - Sub-linear luminance exponent (h^0.6) so bright forehead/cheeks don't hog 80% of particles and blow out
              // - Strong edge gradient weight (0.75 * edgeGrad) so glasses, eyes, nostrils & lips are razor-sharp
              const d =
                (0.22 + 0.5 * Math.pow(h, 0.6) + 0.75 * edgeGrad * (0.35 + 0.65 * h)) *
                (0.45 + 0.55 * nearVal) *
                cutAlpha;

              weightArr[idx] = d;
              weightSum += d;
            } else {
              const maskX = Math.max(0.0, Math.min(1.0, (0.96 - Math.abs(nx)) / (0.96 - 0.32)));
              const smoothX = maskX * maskX * (3.0 - 2.0 * maskX);
              const bgRadial = smoothX * smoothY;
              bgMaskArr[idx] = bgRadial;

              const d = 0.025 * bgRadial * (0.4 + 0.6 * nearVal);
              weightArr[idx] = d;
              weightSum += d;
            }
          }
        }

        // Pass 3: Walk the 2D Hilbert curve and emit exactly totalPoints (524,288) grains
        const rng = createMulberry32(2026);
        const stepWeight = weightSum / totalPoints;
        let targetAccum = rng() * stepWeight;
        let accum = 0;
        let outIdx = 0;
        let lastValidCell = 0;

        const emitGrain = (cellIdx: number) => {
          const col = cellIdx & (gridN - 1);
          const row = cellIdx >> gridShift;
          const p3 = outIdx * 3;
          const p4 = outIdx * 4;

          const nearVal = nearArr[cellIdx];
          const cutAlpha = cutArr[cellIdx];
          const isFg = cutAlpha > 0.45;

          // Sub-pixel jitter within the Hilbert cell in [-1, 1] normalized space
          positions[p3] = ((col + rng()) / gridN) * 2.0 - 1.0;
          positions[p3 + 1] = 1.0 - ((row + rng()) / gridN) * 2.0;
          positions[p3 + 2] = nearVal - 0.5 + 0.014 * (rng() - 0.5);

          if (isFg) {
            const m0 = cleanR[cellIdx];
            const m1 = cleanG[cellIdx];
            const m2 = cleanB[cellIdx];
            const lum = lumArr[cellIdx];
            const edgeGrad = edgeArr[cellIdx];

            // Exact gather.be-of-dao.com sRGB shadow/midtone boost:
            // e = 1 + 0.85 * (min(1 / (0.1 + 0.9 * r), 1 / maxC) - 1)
            const maxC = Math.max(m0, m1, m2, 1.0 / 255.0);
            const boost = 1.0 + 0.85 * (Math.min(1.0 / (0.1 + 0.9 * lum), 1.0 / maxC) - 1.0);

            aCol[p3] = Math.min(1.0, m0 * boost);
            aCol[p3 + 1] = Math.min(1.0, m1 * boost);
            aCol[p3 + 2] = Math.min(1.0, m2 * boost);

            // Tone weight compensates for the higher grain density allocated to dark hair/hoodie
            // while highlighting structural edges (glasses, eyes, hair strands, beard)
            const toneWeight = Math.min(
              1.15,
              0.45 + 0.55 * Math.pow(lum, 0.45) + 0.28 * edgeGrad
            );

            aMeta[p4] = nearVal;
            aMeta[p4 + 1] = 1.0;
            aMeta[p4 + 2] = 1.0;
            aMeta[p4 + 3] = toneWeight;
          } else {
            aCol[p3] = 0.95;
            aCol[p3 + 1] = 0.96;
            aCol[p3 + 2] = 0.98;

            aMeta[p4] = nearVal;
            aMeta[p4 + 1] = 0.0;
            aMeta[p4 + 2] = bgMaskArr[cellIdx];
            aMeta[p4 + 3] = 0.85;
          }

          outIdx++;
        };

        for (let hIdx = 0; hIdx < totalCells && outIdx < totalPoints; hIdx++) {
          const cellIdx = hilbert[hIdx];
          const w = weightArr[cellIdx];
          if (w <= 0) continue;
          accum += w;
          lastValidCell = cellIdx;
          while (accum > targetAccum && outIdx < totalPoints) {
            emitGrain(cellIdx);
            targetAccum += stepWeight;
          }
        }

        while (outIdx < totalPoints) {
          emitGrain(lastValidCell);
        }

        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        metaAttr.needsUpdate = true;

        pointsMesh.visible = true;
        startTime = performance.now();
        gatherProgress = 0;
        isReady = true;
      })
      .catch((err) => {
        console.error('Failed to load particle portrait textures:', err);
      });

    // ── INTERACTIVE 3D ORBIT, DRAG & POINTER WAKE (gather.be-of-dao.com's exact oe() & drag) ──
    let targetRotY = 0;
    let targetRotX = 0;
    let currentRotY = 0;
    let currentRotX = 0;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const wakeTrail: BrushWakePoint[] = [];
    let lastWakeSample: { x: number; y: number; t: number } | null = null;
    let lastWakeMark: { x: number; y: number; t: number } | null = null;

    const recordPointerWake = (clientX: number, clientY: number) => {
      const curW = container.clientWidth || width;
      const curH = container.clientHeight || height;
      const aspect = curW / curH;
      const nowSec = performance.now() / 1000;
      const nx = (clientX / curW) * 2.0 - 1.0;
      const ny = 1.0 - (clientY / curH) * 2.0;

      const prev = lastWakeSample;
      lastWakeSample = { x: nx, y: ny, t: nowSec };
      if (!prev || nowSec - prev.t > 0.2 || nowSec <= prev.t) {
        lastWakeMark = { x: nx, y: ny, t: nowSec };
        return;
      }

      const vx = ((nx - prev.x) * aspect) / (nowSec - prev.t);
      const vy = (ny - prev.y) / (nowSec - prev.t);
      const speed = Math.hypot(vx, vy);
      const mark = lastWakeMark || prev;

      if (
        speed < 0.12 ||
        (Math.hypot((nx - mark.x) * aspect, ny - mark.y) < 0.045 && nowSec - mark.t < 0.09)
      ) {
        return;
      }

      lastWakeMark = { x: nx, y: ny, t: nowSec };
      wakeTrail.push({
        x: nx,
        y: ny,
        dx: vx / speed,
        dy: vy / speed,
        m: Math.max(0.015, Math.min(0.09, 0.028 * speed)),
        t: nowSec,
      });
      if (wakeTrail.length > 6) {
        wakeTrail.shift();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest?.('button, a')) return;
      if (e.pointerType === 'touch' && !isLockedRef.current) return;
      isDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2.0 - 1.0;
      const ny = 1.0 - ((e.clientY - rect.top) / rect.height) * 2.0;
      uniforms.uBurstCenter.value.set(nx, ny);
      uniforms.uBurstProgress.value = 0.01;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        targetRotY += deltaX * 0.0065;
        targetRotX += deltaY * 0.005;

        targetRotX = Math.max(-0.75, Math.min(0.75, targetRotX));
        targetRotY = Math.max(-1.68, Math.min(1.68, targetRotY));
      } else if (e.pointerType !== 'touch') {
        recordPointerWake(e.clientX, e.clientY);
        const curW = container.clientWidth || width;
        const curH = container.clientHeight || height;
        const normX = (e.clientX / curW - 0.5) * 2.0;
        const normY = (e.clientY / curH - 0.5) * 2.0;
        // Subtle parallax on hover so front view stays crisp and centered
        targetRotY = normX * 0.09;
        targetRotX = -normY * 0.05;
      }
    };

    const handlePointerUp = () => {
      isDragging = false;
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    // ── UPDATE MOVING NODES, LAMPS & PROJECT TO 2D SCREEN SPACE ──
    const tempVec = new THREE.Vector3();
    const updateTrackingMarkers = (elapsed: number) => {
      const curW = container.clientWidth || width;
      const curH = container.clientHeight || height;

      trackingNodes.forEach((node) => {
        const t = elapsed * 0.8 + node.phase;
        node.currentPos.x = node.basePos.x + Math.sin(t) * 14.0;
        node.currentPos.y = node.basePos.y + Math.cos(t * 1.15) * 12.0;
        node.currentPos.z = node.basePos.z + Math.sin(t * 0.9) * 16.0;
      });

      const linePosAttr = lineGeo.attributes.position as THREE.BufferAttribute;
      const posArray = linePosAttr.array as Float32Array;
      let lIdx = 0;
      lineEdges.forEach(([from, to]) => {
        const p1 = trackingNodes[from].currentPos;
        const p2 = trackingNodes[to].currentPos;
        posArray[lIdx++] = p1.x;
        posArray[lIdx++] = p1.y;
        posArray[lIdx++] = p1.z;
        posArray[lIdx++] = p2.x;
        posArray[lIdx++] = p2.y;
        posArray[lIdx++] = p2.z;
      });
      linePosAttr.needsUpdate = true;

      const curPlaneW = uniforms.uPlaneSize.value.x;
      const curPlaneH = uniforms.uPlaneSize.value.y;

      const nodeMarkers: ProjectedMarker[] = trackingNodes.map((node) => {
        tempVec.copy(node.currentPos);
        tempVec.applyMatrix4(portraitGroup.matrixWorld);
        tempVec.project(camera);

        const x = (tempVec.x * 0.5 + 0.5) * curW;
        const y = (-tempVec.y * 0.5 + 0.5) * curH;
        const visible = tempVec.z < 1.0 && x >= 0 && x <= curW && y >= 0 && y <= curH;

        const normX = node.currentPos.x / (curPlaneW * 0.5);
        const normY = node.currentPos.y / (curPlaneH * 0.5);
        const normZ = node.currentPos.z / depthExtrusion;
        const label = `${node.id} ${normX >= 0 ? '+' : ''}${normX.toFixed(2)} ${normY >= 0 ? '+' : ''}${normY.toFixed(2)} ${normZ >= 0 ? '+' : ''}${normZ.toFixed(2)}`;

        return { id: node.id, x, y, text: label, visible, alpha: 1.0 };
      });

      const activeLampMarkers: ProjectedMarker[] = [];
      const activeLinks: Array<{ x1: number; y1: number; x2: number; y2: number; alpha: number }> = [];

      lamps.forEach((lamp) => {
        if (lamp.L > 0.04) {
          const worldX = lamp.nx * (curPlaneW * 0.5);
          const worldY = lamp.ny * (curPlaneH * 0.5);
          const worldZ = -lamp.nz * uniforms.uDepthScale.value;

          tempVec.set(worldX, worldY, worldZ);
          tempVec.applyMatrix4(portraitGroup.matrixWorld);
          tempVec.project(camera);

          const lx = (tempVec.x * 0.5 + 0.5) * curW;
          const ly = (-tempVec.y * 0.5 + 0.5) * curH;
          const visible = tempVec.z < 1.0 && lx >= -100 && lx <= curW + 100 && ly >= -100 && ly <= curH + 100;

          if (visible) {
            const label = `LIGHT ${lamp.nx >= 0 ? '+' : ''}${lamp.nx.toFixed(2)} ${lamp.ny >= 0 ? '+' : ''}${lamp.ny.toFixed(2)} ${lamp.nz >= 0 ? '+' : ''}${lamp.nz.toFixed(2)}`;
            const alpha = Math.min(1.0, lamp.L);
            activeLampMarkers.push({
              id: lamp.id,
              x: lx,
              y: ly,
              text: label,
              visible: true,
              alpha,
              isLamp: true,
              coreRadiusPx: Math.max(140, Math.min(curW, curH) * 0.28),
            });

            // Connect lamp to 3 nearest visible tracking nodes in 3D space
            const nearest = trackingNodes
              .map((n, idx) => ({
                screen: nodeMarkers[idx],
                dist: Math.hypot(
                  n.currentPos.x / (curPlaneW * 0.5) - lamp.nx,
                  n.currentPos.y / (curPlaneH * 0.5) - lamp.ny,
                  n.currentPos.z / depthExtrusion + lamp.nz
                ),
              }))
              .filter((item) => item.screen.visible)
              .sort((a, b) => a.dist - b.dist)
              .slice(0, 3);

            nearest.forEach((target) => {
              activeLinks.push({
                x1: lx,
                y1: ly,
                x2: target.screen.x,
                y2: target.screen.y,
                alpha: 0.78 * alpha,
              });
            });
          }
        }
      });

      setMarkers([...nodeMarkers, ...activeLampMarkers]);
      setLampLinks(activeLinks);
    };

    // ── RENDER LOOP ──
    let lastTime = performance.now();

    const animate = (now: number) => {
      animFrameId = requestAnimationFrame(animate);

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const elapsed = (now - startTime) / 1000;
      uniforms.uTime.value = elapsed;

      if (isReady && gatherProgress < 1.0) {
        gatherProgress = Math.min(1.0, gatherProgress + dt * 0.68);
        const t = 1.0 - Math.pow(1.0 - gatherProgress, 3);
        uniforms.uScatter.value = 1.0 - t;
        uniforms.uFade.value = Math.min(1.0, t * 1.2);
      }

      // Update 6-slot pointer wake envelope (gather's ee())
      const nowSec = now / 1000;
      for (let i = 0; i < 6; i++) {
        const w = wakeTrail[i];
        if (w) {
          const age = Math.max(0, nowSec - w.t);
          const env = (1.0 - Math.exp(-age / 0.05)) * Math.exp(-age / 0.75);
          brushUniformArray[i].set(w.x, w.y, w.dx * w.m * env, w.dy * w.m * env);
        } else {
          brushUniformArray[i].set(0, 0, 0, 0);
        }
      }

      // Update 3-lamp bi-exponential snare envelopes (exact Dt(t) from gather.be-of-dao.com)
      let lampSum = 0;
      lamps.forEach((lamp) => {
        lamp.d *= Math.exp(-dt / 0.45);
        lamp.r *= Math.exp(-dt / 0.018);
        lamp.L = Math.min(1.15, Math.max(0.0, lamp.d - lamp.r) / LAMP_ENV_NORM);
        lampSum += lamp.L;
      });

      uniforms.uLamp0.value.set(lamps[0].nx, lamps[0].ny, lamps[0].nz, lamps[0].L);
      uniforms.uLamp1.value.set(lamps[1].nx, lamps[1].ny, lamps[1].nz, lamps[1].L);
      uniforms.uLamp2.value.set(lamps[2].nx, lamps[2].ny, lamps[2].nz, lamps[2].L);
      uniforms.uLampSum.value = Math.min(1.0, lampSum);

      if (uniforms.uBurstProgress.value > 0) {
        uniforms.uBurstProgress.value += dt * 1.8;
        if (uniforms.uBurstProgress.value > 1.4) {
          uniforms.uBurstProgress.value = 0;
        }
      }

      const swayY = Math.sin(elapsed * 0.23) * 0.055;
      const swayX = Math.sin(elapsed * 0.17 + 1.0) * 0.022;

      currentRotY += (targetRotY + swayY - currentRotY) * 0.07;
      currentRotX += (targetRotX + swayX - currentRotX) * 0.07;
      portraitGroup.rotation.y = currentRotY;
      portraitGroup.rotation.x = currentRotX;

      uniforms.uRotY.value = currentRotY;
      uniforms.uRotX.value = currentRotX;

      portraitGroup.updateMatrixWorld();
      updateTrackingMarkers(elapsed);

      renderer?.render(scene, camera);
    };

    animFrameId = requestAnimationFrame(animate);

    // ── RESIZE HANDLER ──
    const handleResize = () => {
      if (!container || !renderer) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      if (newW === 0 || newH === 0) return;

      const curDpr = Math.min(window.devicePixelRatio || 1, 2);
      const newCameraZ = (newH / 2) / Math.tan(fovRad / 2);
      camera.aspect = newW / newH;
      camera.position.set(0, 0, newCameraZ);
      camera.updateProjectionMatrix();

      uniforms.uCameraZ.value = newCameraZ;
      uniforms.uAspect.value = newW / newH;

      const newScale = Math.min(newW / imgWidth, newH / imgHeight) * zoomFactor;
      const newPlaneW = imgWidth * newScale;
      const newPlaneH = imgHeight * newScale;
      uniforms.uPlaneSize.value.set(newPlaneW, newPlaneH);

      const updatedMetrics = computeSizeAndGain(newPlaneH, curDpr);
      uniforms.uPointSize.value = updatedMetrics.pointSize;
      uniforms.uGain.value = updatedMetrics.gain;

      const newBleedBottom = Math.max(36, newH * 0.045);
      const newPosY = -(newH / 2) + newPlaneH / 2 - newBleedBottom;
      portraitGroup.position.set(0, newPosY, 0);

      renderer.setPixelRatio(curDpr);
      renderer.setSize(newW, newH);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('resize', handleResize);

      portraitGroup.remove(pointsMesh);
      portraitGroup.remove(lineSegments);
      geometry.dispose();
      material.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer?.dispose();
      if (renderer?.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [imageSrc, depthSrc]);

  return (
    <div
      ref={containerRef}
      className="particle-depth-wrapper"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        cursor: 'grab',
        touchAction: isLocked ? 'none' : 'pan-y',
        overflow: 'hidden',
      }}
    >
      {/* ── CAD / TELEMETRY HUD TICK RULER BORDER (DAO STYLE) ── */}
      <div className="dao-cad-frame" aria-hidden="true">
        <span className="cad-corner cad-tl">+</span>
        <span className="cad-corner cad-tr">+</span>
        <span className="cad-corner cad-bl">+</span>
        <span className="cad-corner cad-br">+</span>

        <div className="cad-ruler cad-ruler-top" />
        <div className="cad-ruler cad-ruler-bottom" />
        <div className="cad-ruler cad-ruler-left" />
        <div className="cad-ruler cad-ruler-right" />

        <div className="cad-telemetry-tag top-left">01 / 01 // YASH 聚</div>
        <div className="cad-telemetry-tag bottom-left">524,288 PTS</div>
      </div>

      {/* ── DYNAMIC LAMP-TO-NODE TELEMETRY LINKS (DAO STYLE) ── */}
      {lampLinks.length > 0 && (
        <svg
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 4,
          }}
        >
          {lampLinks.map((lnk, idx) => (
            <line
              key={idx}
              x1={lnk.x1}
              y1={lnk.y1}
              x2={lnk.x2}
              y2={lnk.y2}
              stroke={`rgba(255, 255, 255, ${lnk.alpha.toFixed(3)})`}
              strokeWidth="1"
            />
          ))}
        </svg>
      )}

      {/* ── 3D TELEMETRY TRACKING BOXES [+] & VOLUMETRIC LAMP CORES (DAO STYLE) ── */}
      <div className="dao-markers-layer" aria-hidden="true">
        {markers.map((m) =>
          m.visible ? (
            <div
              key={m.id}
              className={`telemetry-box ${m.isLamp ? 'is-flashing' : ''}`}
              style={{
                transform: `translate3d(${m.x}px, ${m.y}px, 0)`,
                opacity: m.alpha,
              }}
            >
              {m.isLamp && (
                <div
                  style={{
                    position: 'absolute',
                    top: 7,
                    left: 7,
                    width: (m.coreRadiusPx || 220) * 2,
                    height: (m.coreRadiusPx || 220) * 2,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle, rgba(255, 233, 196, 0.52) 0%, rgba(255, 233, 196, 0.18) 28%, rgba(255, 233, 196, 0.04) 56%, transparent 75%)',
                    mixBlendMode: 'screen',
                    pointerEvents: 'none',
                  }}
                />
              )}

              <div className="telemetry-bracket">
                <span className="corner corner-tl" />
                <span className="corner corner-tr" />
                <span className="telemetry-cross">+</span>
                <span className="corner corner-bl" />
                <span className="corner corner-br" />
              </div>
              <span className="telemetry-coord">{m.text}</span>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
};

export default ParticleDepthPortrait;



