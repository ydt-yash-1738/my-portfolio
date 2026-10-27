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

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(backgroundColor);

      const camera = new THREE.OrthographicCamera(
        width / -2,
        width / 2,
        height / 2,
        height / -2,
        0.1,
        1000
      );
      camera.position.z = 1;

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
              return;
            }
            const curW = container!.clientWidth || w;
            const curH = container!.clientHeight || h;
            this.uniforms.pointer.value.x = ((event.clientX - rect.left) / curW) * 2 - 1;
            this.uniforms.pointer.value.y = -((event.clientY - rect.top) / curH) * 2 + 1;
          };

          const handleTouchMove = (event: TouchEvent) => {
            if (event.touches.length > 0) {
              const rect = container!.getBoundingClientRect();
              const curW = container!.clientWidth || w;
              const curH = container!.clientHeight || h;
              const touch = event.touches[0];
              this.uniforms.pointer.value.x = ((touch.clientX - rect.left) / curW) * 2 - 1;
              this.uniforms.pointer.value.y = -((touch.clientY - rect.top) / curH) * 2 + 1;
            }
          };

          const handleMouseLeave = () => {
            this.uniforms.pointer.value.set(10, 10);
          };

          window.addEventListener('mousemove', handleMouseMove, { passive: true });
          container!.addEventListener('touchmove', handleTouchMove, { passive: true });
      container!.addEventListener('touchstart', handleTouchMove, { passive: true });
          document.addEventListener('mouseleave', handleMouseLeave);
          container!.addEventListener('touchend', handleMouseLeave);

          this.removeListeners = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            container!.removeEventListener('touchmove', handleTouchMove);
      container!.removeEventListener('touchstart', handleTouchMove);
            document.removeEventListener('mouseleave', handleMouseLeave);
            container!.removeEventListener('touchend', handleMouseLeave);
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

      const updatePortraitGeometry = (img: HTMLImageElement, viewW: number, viewH: number) => {
        const scale = Math.min(viewW / img.width, viewH / img.height);
        const planeWidth = img.width * scale;
        const planeHeight = img.height * scale;
        const posY = -(viewH / 2) + planeHeight / 2;

        if (baseImage) {
          baseImage.geometry.dispose();
          baseImage.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
          baseImage.position.set(0, posY, 0);
        }
        if (helmetImage) {
          helmetImage.geometry.dispose();
          helmetImage.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
          helmetImage.position.set(0, posY, 0.1);
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

      // Layer -0.05: Slow-moving ambient topographic contour lines across the entire hero background
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
      });

      ambientBgPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), ambientBgMaterial);
      ambientBgPlane.position.z = -0.05;
      scene.add(ambientBgPlane);

      // Layer 0: Base portrait (RGBA cutout, so ambient moving contours flow cleanly behind head & shoulders)
      const baseImageMaterial = new THREE.MeshBasicMaterial({
        map: baseTexture,
        transparent: true,
      });
      baseImage = new THREE.Mesh(new THREE.PlaneGeometry(width, height), baseImageMaterial);
      baseImage.position.z = 0;
      scene.add(baseImage);

      // Layer 0.05: Hover blob contour plane
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
      });

      bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), bgPlaneMaterial);
      bgPlane.position.z = 0.05;
      scene.add(bgPlane);

      // Layer 0.1: Reveal image (Marc Márquez Shoei helmet)
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
      });

      helmetImage = new THREE.Mesh(new THREE.PlaneGeometry(width, height), helmetImageMaterial);
      helmetImage.position.z = 0.1;
      scene.add(helmetImage);

      const clock = new THREE.Clock();
      let animationId: number;

      const animate = () => {
        const dt = Math.min(clock.getDelta(), 0.1);
        gu.time.value += dt;
        gu.dTime.value = dt;

        bgPlaneMaterial.uniforms.texBlob.value = blob.rtOutput.texture;
        helmetImageMaterial.uniforms.texBlob.value = blob.rtOutput.texture;

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

        camera.left = newWidth / -2;
        camera.right = newWidth / 2;
        camera.top = newHeight / 2;
        camera.bottom = newHeight / -2;
        camera.updateProjectionMatrix();

        renderer.setSize(newWidth, newHeight);
        blob.resize(newWidth, newHeight);
        gu.aspect.value = newWidth / newHeight;

        ambientBgPlane.geometry.dispose();
        ambientBgPlane.geometry = new THREE.PlaneGeometry(newWidth, newHeight);

        bgPlane.geometry.dispose();
        bgPlane.geometry = new THREE.PlaneGeometry(newWidth, newHeight);

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
