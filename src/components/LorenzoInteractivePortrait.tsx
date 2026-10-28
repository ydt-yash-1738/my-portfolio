import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export interface LorenzoInteractivePortraitProps {
  baseImageUrl?: string;
  revealImageUrl?: string;
  backgroundColor?: string;
  blobRadius?: number;
  blobFadeSpeed?: number;
  colorBgVec3?: string;
  colorSoftShapeVec3?: string;
  colorLineVec3?: string;
  fadeInDelay?: number;
  fadeInDuration?: number;
}

function parseVec3(vec3String: string): [number, number, number] {
  const parts = vec3String.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    return [parts[0], parts[1], parts[2]];
  }
  return [1, 1, 1];
}

// ══════════════════════════════════════════════════════════════════
// AUTOMATIC TEASER SWIPES CONFIGURATION
// You can adjust the radius, coordinates, or add new swipe paths below.
// Coordinate space is normalized screen space (-1.0 to +1.0):
//   X: -1.0 (far left) to +1.0 (far right) | Portrait head is ~ -0.42 to +0.40
//   Y: -1.0 (bottom) to +1.0 (top)        | Face / helmet is ~ -0.05 to +0.45
// ══════════════════════════════════════════════════════════════════
const TEASER_BLOB_RADIUS = 0.045; // Glimpse thickness (smaller = thinner slit, default was 0.07)

interface SwipeTrajectory {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface SwipePairConfig {
  name: string;
  swipe1: SwipeTrajectory;
  swipe2: SwipeTrajectory;
}

const TEASER_SWIPE_PAIRS: SwipePairConfig[] = [
  {
    name: 'Upper Visor & Helmet Crown',
    swipe1: { startX: -0.42, startY: 0.32, endX: 0.38, endY: 0.24 }, // Long horizontal cut across the visor
    swipe2: { startX: 0.36, startY: 0.44, endX: -0.36, endY: 0.20 }, // Long diagonal cut across helmet crown
  },
  {
    name: 'Mid-Face & Cheek Red Graphics',
    swipe1: { startX: -0.40, startY: 0.12, endX: 0.40, endY: 0.06 }, // Long sweep across cheek & red graphics
    swipe2: { startX: -0.34, startY: -0.04, endX: 0.36, endY: 0.18 }, // Diagonal cut up through chin and visor
  },
  {
    name: 'Full Diagonal Slash',
    swipe1: { startX: -0.38, startY: 0.40, endX: 0.38, endY: -0.02 }, // Top-left to bottom-right full slash
    swipe2: { startX: 0.38, startY: 0.32, endX: -0.38, endY: 0.08 }, // Top-right to bottom-left full slash
  },
];

export const LorenzoInteractivePortrait: React.FC<LorenzoInteractivePortraitProps> = ({
  baseImageUrl = '/portrait-base-cutout.png',
  revealImageUrl = '/marquez-reveal-4k.png',
  backgroundColor = '#FFFFFF',
  blobRadius = 0.15,
  blobFadeSpeed = 1,
  colorBgVec3 = '1.0, 1.0, 1.0',
  colorSoftShapeVec3 = '0.961, 0.961, 0.961',
  colorLineVec3 = '0.89, 0.89, 0.89',
  fadeInDelay = 0.15,
  fadeInDuration = 0.6,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    const initScene = () => {
      if (disposed || !container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) {
        setTimeout(initScene, 50);
        return;
      }

      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      const colorBgArray = parseVec3(colorBgVec3);
      const colorSoftShapeArray = parseVec3(colorSoftShapeVec3);
      const colorLineArray = parseVec3(colorLineVec3);

      const gu = {
        time: { value: 0 },
        dTime: { value: 0 },
        aspect: { value: width / height },
      };

      // ── PERSPECTIVE CAMERA ──
      // Calibrated so at z = 0, exactly 1 unit = 1 pixel
      const fov = 45;
      const fovRad = (fov * Math.PI) / 180;
      let cameraZ = (height / 2) / Math.tan(fovRad / 2);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(backgroundColor);

      const camera = new THREE.PerspectiveCamera(fov, width / height, 1, 10000);
      camera.position.set(0, 0, cameraZ);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);

      const timerId = setTimeout(() => {
        setIsReady(true);
      }, fadeInDelay * 1000);

      // ── SUBTLE 3D TILT STATE FOR THE PORTRAIT ──
      const MAX_TILT_Y = (3.2 * Math.PI) / 180; // ~3.2 deg left-right rotation
      const MAX_TILT_X = (1.6 * Math.PI) / 180; // ~1.6 deg vertical pitch
      const LERP = 0.08;

      let currentTiltX = 0;
      let currentTiltY = 0;
      let mouseTargetX = 0;
      let mouseTargetY = 0;
      let touchTargetX = 0;
      let touchTargetY = 0;
      let isTouching = false;
      let gyroTargetX = 0;
      let gyroTargetY = 0;
      let hasGyro = false;

      // Track manual user interaction for automatic hint swipes
      let isUserInteracting = false;
      let lastInteractionTime = performance.now();

      const handleOrientation = (e: DeviceOrientationEvent) => {
        if (e.gamma === null || e.beta === null) return;
        hasGyro = true;

        let gamma = e.gamma;
        let beta = e.beta;

        const orientationAngle =
          window.screen?.orientation?.angle ??
          (typeof window.orientation === 'number' ? window.orientation : 0);

        if (orientationAngle === 90) {
          const tmp = gamma;
          gamma = -beta;
          beta = tmp;
        } else if (orientationAngle === -90 || orientationAngle === 270) {
          const tmp = gamma;
          gamma = beta;
          beta = -tmp;
        }

        const normGamma = Math.max(-1, Math.min(1, gamma / 25));
        const normBeta = Math.max(-1, Math.min(1, (beta - 48) / 25));

        gyroTargetY = normGamma * MAX_TILT_Y;
        gyroTargetX = -normBeta * MAX_TILT_X;
      };

      const requestGyroPermission = async () => {
        if (
          typeof DeviceOrientationEvent !== 'undefined' &&
          typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
            .requestPermission === 'function'
        ) {
          try {
            const res = await (
              DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
            ).requestPermission();
            if (res === 'granted') {
              window.addEventListener('deviceorientation', handleOrientation, { passive: true });
            }
          } catch {
            // ignore
          }
        }
      };

      class Blob {
        renderer: THREE.WebGLRenderer;
        rtOutput: THREE.WebGLRenderTarget;
        prevRenderTarget: THREE.WebGLRenderTarget;
        rtScene: THREE.Mesh;
        rtCamera: THREE.Camera;
        uniforms: {
          pointer: { value: THREE.Vector2 };
          pointerDown: { value: number };
          pointerRadius: { value: number };
          pointerDuration: { value: number };
          prevFrame: { value: THREE.Texture };
          time: { value: number };
          dTime: { value: number };
          aspect: { value: number };
        };
        removeListeners: () => void;

        constructor(rnd: THREE.WebGLRenderer, w: number, h: number) {
          this.renderer = rnd;
          this.rtOutput = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
          });
          this.prevRenderTarget = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
          });

          this.uniforms = {
            pointer: { value: new THREE.Vector2(10, 10) },
            pointerDown: { value: 1 },
            pointerRadius: { value: blobRadius },
            pointerDuration: { value: blobFadeSpeed },
            prevFrame: { value: this.prevRenderTarget.texture },
            time: gu.time,
            dTime: gu.dTime,
            aspect: gu.aspect,
          };

          const handleMouseMove = (event: MouseEvent) => {
            const rect = container!.getBoundingClientRect();
            if (event.clientY < rect.top || event.clientY > rect.bottom) {
              this.uniforms.pointer.value.set(10, 10);
              mouseTargetX = 0;
              mouseTargetY = 0;
              isUserInteracting = false;
              lastInteractionTime = performance.now();
              return;
            }
            isUserInteracting = true;
            lastInteractionTime = performance.now();
            this.uniforms.pointerRadius.value = blobRadius;

            const curW = container!.clientWidth || w;
            const curH = container!.clientHeight || h;
            const normX = ((event.clientX - rect.left) / curW) * 2 - 1;
            const normY = -((event.clientY - rect.top) / curH) * 2 + 1;
            this.uniforms.pointer.value.x = normX;
            this.uniforms.pointer.value.y = normY;

            mouseTargetY = Math.max(-1, Math.min(1, normX)) * MAX_TILT_Y;
            mouseTargetX = Math.max(-1, Math.min(1, -normY)) * MAX_TILT_X;
          };

          const handleTouchMove = (event: TouchEvent) => {
            if (event.touches.length > 0) {
              isUserInteracting = true;
              lastInteractionTime = performance.now();
              this.uniforms.pointerRadius.value = blobRadius;

              const rect = container!.getBoundingClientRect();
              const curW = container!.clientWidth || w;
              const curH = container!.clientHeight || h;
              const touch = event.touches[0];
              const normX = ((touch.clientX - rect.left) / curW) * 2 - 1;
              const normY = -((touch.clientY - rect.top) / curH) * 2 + 1;
              this.uniforms.pointer.value.x = normX;
              this.uniforms.pointer.value.y = normY;

              touchTargetY = Math.max(-1, Math.min(1, normX)) * MAX_TILT_Y;
              touchTargetX = Math.max(-1, Math.min(1, -normY)) * MAX_TILT_X;
            }
          };

          const handleTouchStart = (event: TouchEvent) => {
            isTouching = true;
            isUserInteracting = true;
            lastInteractionTime = performance.now();
            this.uniforms.pointerRadius.value = blobRadius;
            handleTouchMove(event);
            requestGyroPermission();
          };

          const handleMouseLeave = () => {
            this.uniforms.pointer.value.set(10, 10);
            mouseTargetX = 0;
            mouseTargetY = 0;
            isUserInteracting = false;
            lastInteractionTime = performance.now();
          };

          const handleTouchEnd = () => {
            isTouching = false;
            isUserInteracting = false;
            lastInteractionTime = performance.now();
            this.uniforms.pointer.value.set(10, 10);
          };

          window.addEventListener('mousemove', handleMouseMove, { passive: true });
          container!.addEventListener('touchmove', handleTouchMove, { passive: true });
          container!.addEventListener('touchstart', handleTouchStart, { passive: true });
          document.addEventListener('mouseleave', handleMouseLeave);
          container!.addEventListener('touchend', handleTouchEnd);
          container!.addEventListener('touchcancel', handleTouchEnd);

          if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
            window.addEventListener('deviceorientation', handleOrientation, { passive: true });
          }

          this.removeListeners = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            container!.removeEventListener('touchmove', handleTouchMove);
            container!.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('mouseleave', handleMouseLeave);
            container!.removeEventListener('touchend', handleTouchEnd);
            container!.removeEventListener('touchcancel', handleTouchEnd);
            window.removeEventListener('deviceorientation', handleOrientation);
          };

          const blobMaterial = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: `
              varying vec2 vUv;
              void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
              }
            `,
            fragmentShader: `
              uniform float time, dTime, aspect, pointerDown, pointerRadius, pointerDuration;
              uniform vec2 pointer;
              uniform sampler2D prevFrame;
              varying vec2 vUv;

              float hash(vec2 p) { 
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); 
              }
              
              float noise(vec2 p) {
                vec2 i = floor(p); 
                vec2 f = fract(p); 
                f = f * f * (3.0 - 2.0 * f);
                float a = hash(i); 
                float b = hash(i + vec2(1.0, 0.0)); 
                float c = hash(i + vec2(0.0, 1.0)); 
                float d = hash(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
              }

              void main() {
                float rVal = texture2D(prevFrame, vUv).r;
                rVal -= clamp(dTime / pointerDuration, 0.0, 0.05);
                rVal = clamp(rVal, 0.0, 1.0);
                
                float f = 0.0;
                if (pointerDown > 0.5) {
                  vec2 uv = (vUv - 0.5) * 2.0 * vec2(aspect, 1.0);
                  vec2 mouse = pointer * vec2(aspect, 1.0);
                  vec2 toMouse = uv - mouse;
                  float angle = atan(toMouse.y, toMouse.x);
                  float dist = length(toMouse);
                  
                  float noiseVal = noise(vec2(angle * 3.0 + time * 0.5, dist * 5.0));
                  float noiseVal2 = noise(vec2(angle * 5.0 - time * 0.3, dist * 3.0 + time));
                  float radiusVariation = 0.7 + noiseVal * 0.5 + noiseVal2 * 0.3;
                  float organicRadius = pointerRadius * radiusVariation;
                  
                  f = 1.0 - smoothstep(organicRadius * 0.05, organicRadius * 1.2, dist);
                  f *= 0.8 + noiseVal * 0.2;
                }
                
                rVal += f * 0.25;
                rVal = clamp(rVal, 0.0, 1.0);
                
                gl_FragColor = vec4(vec3(rVal), 1.0);
              }
            `,
          });

          this.rtScene = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blobMaterial);
          this.rtCamera = new THREE.Camera();
        }

        render() {
          this.renderer.setRenderTarget(this.rtOutput);
          this.renderer.render(this.rtScene, this.rtCamera);
          this.renderer.setRenderTarget(null);

          const temp = this.prevRenderTarget;
          this.prevRenderTarget = this.rtOutput;
          this.rtOutput = temp;

          this.uniforms.prevFrame.value = this.prevRenderTarget.texture;
        }

        resize(newW: number, newH: number) {
          this.rtOutput.setSize(newW, newH);
          this.prevRenderTarget.setSize(newW, newH);
        }

        dispose() {
          this.removeListeners();
          this.rtOutput.dispose();
          this.prevRenderTarget.dispose();
        }
      }

      const blob = new Blob(renderer, width, height);
      const textureLoader = new THREE.TextureLoader();
      textureLoader.crossOrigin = 'anonymous';
      const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

      let ambientBgPlane: THREE.Mesh;
      let baseImage: THREE.Mesh;
      let helmetImage: THREE.Mesh;
      let bgPlane: THREE.Mesh;

      // ── PORTRAIT GROUP (ONLY THIS TILTS IN 3D) ──
      const portraitGroup = new THREE.Group();
      portraitGroup.renderOrder = 2;
      scene.add(portraitGroup);

      const updatePortraitGeometry = (img: HTMLImageElement, viewW: number, viewH: number) => {
        // Zoom in slightly (~7%) and bleed the bottom below viewport so 3D tilt never exposes a bottom gap
        const baseScale = Math.min(viewW / img.width, viewH / img.height);
        const zoomFactor = 1.07;
        const scale = baseScale * zoomFactor;

        const planeWidth = img.width * scale;
        const planeHeight = img.height * scale;

        // Bleed bottom edge ~36px below floor so perspective tilt corners stay hidden below the fold
        const bleedBottom = Math.max(36, viewH * 0.045);
        const posY = -(viewH / 2) + planeHeight / 2 - bleedBottom;

        // Visual pivot at portrait center
        portraitGroup.position.set(0, posY, 0);

        if (baseImage) {
          baseImage.geometry.dispose();
          baseImage.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
          baseImage.position.set(0, 0, 0);
        }
        if (helmetImage) {
          helmetImage.geometry.dispose();
          helmetImage.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
          helmetImage.position.set(0, 0, 1.0);
        }
      };

      const baseTexture = textureLoader.load(baseImageUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = maxAnisotropy;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        if (texture.image && container) {
          updatePortraitGeometry(texture.image, container.clientWidth, container.clientHeight);
        }
      });

      const helmetTexture = textureLoader.load(revealImageUrl, (texture) => {
        texture.anisotropy = maxAnisotropy;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        if (baseTexture.image && container) {
          updatePortraitGeometry(baseTexture.image, container.clientWidth, container.clientHeight);
        } else if (texture.image && container) {
          updatePortraitGeometry(texture.image, container.clientWidth, container.clientHeight);
        }
      });

      // Layer 0: Slow-moving ambient topographic contour lines across the background
      // Sits at z = -50 with depthWrite: false and depthTest: false so it NEVER occludes the portrait!
      const ambientBgMaterial = new THREE.ShaderMaterial({
        uniforms: {
          time: gu.time,
          aspect: gu.aspect,
          colorBg: { value: new THREE.Vector3(...colorBgArray) },
          colorSoftShape: { value: new THREE.Vector3(0.985, 0.985, 0.982) },
          colorLine: { value: new THREE.Vector3(0.895, 0.89, 0.875) },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          uniform float aspect;
          uniform vec3 colorBg;
          uniform vec3 colorSoftShape;
          uniform vec3 colorLine;
          varying vec2 vUv;

          float hash(vec2 p) { 
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); 
          }
          
          float noise(vec2 p) {
            vec2 i = floor(p); 
            vec2 f = fract(p); 
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i); 
            float b = hash(i + vec2(1.0, 0.0)); 
            float c = hash(i + vec2(0.0, 1.0)); 
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
          
          float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.5;
            for (int i = 0; i < 4; i++) {
              value += amplitude * noise(p);
              p *= 2.05;
              amplitude *= 0.35;
            }
            return value;
          }

          void main() {
            vec2 uv = vec2(vUv.x * aspect, vUv.y) * 2.2;
            float slowTime = time * 0.09;
            vec2 drift = vec2(slowTime * 0.35, -slowTime * 0.22);
            float distortion = fbm(uv * 0.75 + drift);
            vec2 warpedUv = uv + (distortion - 0.5) * 0.65 + vec2(slowTime * 0.15, slowTime * 0.1);
            float n = fbm(warpedUv);

            float softShapeMix = smoothstep(0.15, 0.85, sin(n * 3.0 + slowTime));
            vec3 baseColor = mix(colorBg, colorSoftShape, softShapeMix);

            // Smooth topographic contour lines
            float linePattern = fract(n * 11.0);
            float lineDist = abs(linePattern - 0.5);
            float lineMix = 1.0 - smoothstep(0.008, 0.022, lineDist);

            vec3 finalColor = mix(baseColor, colorLine, lineMix);
            gl_FragColor = vec4(finalColor, 1.0);
          }
        `,
        depthWrite: false,
        depthTest: false,
      });

      ambientBgPlane = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, height * 1.5), ambientBgMaterial);
      ambientBgPlane.position.set(0, 0, -50);
      ambientBgPlane.renderOrder = 0;
      scene.add(ambientBgPlane);

      // Layer 1: Hover blob contour plane on the background (behind portrait, depthWrite: false)
      const bgPlaneMaterial = new THREE.ShaderMaterial({
        uniforms: {
          texBlob: { value: blob.rtOutput.texture },
          time: gu.time,
          colorBg: { value: new THREE.Vector3(...colorBgArray) },
          colorSoftShape: { value: new THREE.Vector3(...colorSoftShapeArray) },
          colorLine: { value: new THREE.Vector3(...colorLineArray) },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec4 vPosProj;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            vPosProj = gl_Position;
          }
        `,
        fragmentShader: `
          uniform sampler2D texBlob;
          uniform float time;
          uniform vec3 colorBg;
          uniform vec3 colorSoftShape;
          uniform vec3 colorLine;
          varying vec2 vUv;
          varying vec4 vPosProj;

          float hash(vec2 p) { 
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); 
          }
          
          float noise(vec2 p) {
            vec2 i = floor(p); 
            vec2 f = fract(p); 
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i); 
            float b = hash(i + vec2(1.0, 0.0)); 
            float c = hash(i + vec2(0.0, 1.0)); 
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
          
          float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.5;
            for (int i = 0; i < 4; i++) {
              value += amplitude * noise(p);
              p *= 2.1;
              amplitude *= 0.3;
            }
            return value;
          }

          void main() {
            vec2 blobUV = ((vPosProj.xy / vPosProj.w) + 1.0) * 0.5;
            vec4 blobData = texture2D(texBlob, blobUV);
            
            if (blobData.r < 0.02) discard;

            vec2 uv = vUv * 3.5;
            vec2 distortionField = vUv * 2.0;
            float distortion = fbm(distortionField + time * 0.2);
            float distortionStrength = 0.7;
            vec2 warpedUv = uv + (distortion - 0.5) * distortionStrength;
            float n = fbm(warpedUv);

            float softShapeMix = smoothstep(0.1, 0.9, sin(n * 3.0));
            vec3 baseColor = mix(colorBg, colorSoftShape, softShapeMix);
            float linePattern = fract(n * 15.0);
            float lineMix = 1.0 - smoothstep(0.49, 0.51, linePattern);
            vec3 finalColor = mix(baseColor, colorLine, lineMix);

            float edgeAlpha = smoothstep(0.02, 0.06, blobData.r);
            gl_FragColor = vec4(finalColor, edgeAlpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });

      bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, height * 1.5), bgPlaneMaterial);
      bgPlane.position.set(0, 0, -10);
      bgPlane.renderOrder = 1;
      scene.add(bgPlane);

      // Layer 2: Base portrait inside portraitGroup
      const baseImageMaterial = new THREE.MeshBasicMaterial({
        map: baseTexture,
        transparent: true,
        depthWrite: false,
      });
      baseImage = new THREE.Mesh(new THREE.PlaneGeometry(width, height), baseImageMaterial);
      baseImage.position.set(0, 0, 0);
      baseImage.renderOrder = 2;
      portraitGroup.add(baseImage);

      // Layer 3: Reveal image (Shoei helmet) inside portraitGroup
      const helmetImageMaterial = new THREE.ShaderMaterial({
        uniforms: {
          texBlob: { value: blob.rtOutput.texture },
          map: { value: helmetTexture },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec4 vPosProj;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            vPosProj = gl_Position;
          }
        `,
        fragmentShader: `
          uniform sampler2D texBlob;
          uniform sampler2D map;
          varying vec2 vUv;
          varying vec4 vPosProj;

          void main() {
            vec2 blobUV = ((vPosProj.xy / vPosProj.w) + 1.0) * 0.5;
            vec4 blobData = texture2D(texBlob, blobUV);
            
            if (blobData.r < 0.02) discard;

            vec4 texColor = texture2D(map, vUv);
            float edgeAlpha = smoothstep(0.02, 0.06, blobData.r);
            gl_FragColor = vec4(texColor.rgb, texColor.a * edgeAlpha);
          }
        `,
        transparent: true,
        depthWrite: false,
      });

      helmetImage = new THREE.Mesh(new THREE.PlaneGeometry(width, height), helmetImageMaterial);
      helmetImage.position.set(0, 0, 1.0);
      helmetImage.renderOrder = 3;
      portraitGroup.add(helmetImage);

      const clock = new THREE.Clock();
      let animationId: number;

      const animate = () => {
        const dt = Math.min(clock.getDelta(), 0.1);
        gu.time.value += dt;
        gu.dTime.value = dt;

        bgPlaneMaterial.uniforms.texBlob.value = blob.rtOutput.texture;
        helmetImageMaterial.uniforms.texBlob.value = blob.rtOutput.texture;

        // Smoothly interpolate portrait 3D tilt
        let targetX = 0;
        let targetY = 0;
        if (isTouching) {
          targetX = touchTargetX;
          targetY = touchTargetY;
        } else if (hasGyro) {
          targetX = gyroTargetX;
          targetY = gyroTargetY;
        } else {
          targetX = mouseTargetX;
          targetY = mouseTargetY;
        }

        currentTiltX += (targetX - currentTiltX) * LERP;
        currentTiltY += (targetY - currentTiltY) * LERP;

        portraitGroup.rotation.y = currentTiltY;
        portraitGroup.rotation.x = currentTiltX;

        // ── AUTOMATIC TEASER SWIPES EVERY ~3 SECONDS WHEN USER IS IDLE ──
        const now = performance.now();
        const timeSinceInteraction = now - lastInteractionTime;

        if (!isUserInteracting && timeSinceInteraction > 1400) {
          const cycleTime = 3.2; // 3.2s total cycle (~3s recurring)
          const idleSec = (timeSinceInteraction - 1400) / 1000;
          const cycleIndex = Math.floor(idleSec / cycleTime) % TEASER_SWIPE_PAIRS.length;
          const currentPair = TEASER_SWIPE_PAIRS[cycleIndex];
          const cycleT = idleSec % cycleTime;

          // Swipe 1: 0.0s to 0.50s (first long swipe across portrait)
          if (cycleT < 0.50) {
            const p = cycleT / 0.50;
            const easeP = p * p * (3 - 2 * p);
            const { startX, startY, endX, endY } = currentPair.swipe1;

            blob.uniforms.pointerRadius.value = TEASER_BLOB_RADIUS;
            blob.uniforms.pointer.value.set(
              startX + (endX - startX) * easeP,
              startY + (endY - startY) * easeP
            );
          }
          // Pause between swipes: 0.50s to 0.75s
          else if (cycleT < 0.75) {
            blob.uniforms.pointer.value.set(10, 10);
          }
          // Swipe 2: 0.75s to 1.25s (second long swipe across portrait)
          else if (cycleT < 1.25) {
            const p = (cycleT - 0.75) / 0.50;
            const easeP = p * p * (3 - 2 * p);
            const { startX, startY, endX, endY } = currentPair.swipe2;

            blob.uniforms.pointerRadius.value = TEASER_BLOB_RADIUS;
            blob.uniforms.pointer.value.set(
              startX + (endX - startX) * easeP,
              startY + (endY - startY) * easeP
            );
          }
          // Rest period: 1.25s to 3.2s (~2 seconds pause before next pair)
          else {
            blob.uniforms.pointer.value.set(10, 10);
            blob.uniforms.pointerRadius.value = blobRadius;
          }
        }

        blob.render();
        renderer.render(scene, camera);
        animationId = requestAnimationFrame(animate);
      };

      animate();

      const handleResize = () => {
        if (!container) return;
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        if (newWidth === 0 || newHeight === 0) return;

        camera.aspect = newWidth / newHeight;
        cameraZ = (newHeight / 2) / Math.tan(fovRad / 2);
        camera.position.z = cameraZ;
        camera.updateProjectionMatrix();

        renderer.setSize(newWidth, newHeight);
        blob.resize(newWidth, newHeight);
        gu.aspect.value = newWidth / newHeight;

        ambientBgPlane.geometry.dispose();
        ambientBgPlane.geometry = new THREE.PlaneGeometry(newWidth * 1.5, newHeight * 1.5);

        bgPlane.geometry.dispose();
        bgPlane.geometry = new THREE.PlaneGeometry(newWidth * 1.5, newHeight * 1.5);

        const img = baseTexture.image || helmetTexture.image;
        if (img) {
          updatePortraitGeometry(img, newWidth, newHeight);
        }
      };

      window.addEventListener('resize', handleResize);

      cleanupRef.current = () => {
        clearTimeout(timerId);
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animationId);

        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }

        renderer.dispose();
        blob.dispose();
        baseTexture.dispose();
        helmetTexture.dispose();

        scene.traverse((object) => {
          if ((object as THREE.Mesh).geometry) {
            (object as THREE.Mesh).geometry.dispose();
          }
          if ((object as THREE.Mesh).material) {
            const mat = (object as THREE.Mesh).material;
            if (Array.isArray(mat)) {
              mat.forEach((m) => m.dispose());
            } else {
              mat.dispose();
            }
          }
        });
      };
    };

    initScene();

    return () => {
      disposed = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [
    baseImageUrl,
    revealImageUrl,
    backgroundColor,
    blobRadius,
    blobFadeSpeed,
    colorBgVec3,
    colorSoftShapeVec3,
    colorLineVec3,
    fadeInDelay,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor,
        cursor: 'default',
        overflow: 'hidden',
        touchAction: 'pan-y',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor,
          opacity: isReady ? 0 : 1,
          transition: `opacity ${fadeInDuration}s ease-out`,
          pointerEvents: isReady ? 'none' : 'auto',
          zIndex: 10,
        }}
      />
    </div>
  );
};

export default LorenzoInteractivePortrait;
