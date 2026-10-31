# 3D Particle Depth, Hilbert-Curve Importance Sampling & Lamp Reflection Architecture (`Gather 聚` Inspired)

This document details the end-to-end mathematical and rendering logic powering the 3D Particle Depth Portrait in [`ParticleDepthPortrait.tsx`](file:///d:/portfolio/client/src/components/ParticleDepthPortrait.tsx) and the offline depth-map pipeline in [`generate_depth.py`](file:///d:/portfolio/client/scripts/generate_depth.py), inspired by [gather.be-of-dao.com](https://gather.be-of-dao.com/).

---

## 1. Root Causes of Previous Coarse Grains & Missing Facial Details

When comparing the portfolio's previous particle portrait against `gather.be-of-dao.com`, five specific factors caused coarse blotches, oversaturated orange skin tones, and missing shadow/edge details:

1. **WebGL2 Hardware sRGB-to-Linear Gamma Crushing (`tex.colorSpace = THREE.SRGBColorSpace`)**:
   - Uploading `uTexture` with `THREE.SRGBColorSpace` onto a raw `THREE.ShaderMaterial` caused WebGL2's `SRGB8_ALPHA8` sampler to apply $c^{2.2}$ linearization before the vertex shader's color boost, without any sRGB output re-encoding.
   - This crushed dark and midtone values (hair strands, eyebrow hairs, iris details, glasses rims, beard stubble, and hoodie folds) by up to $6\times$ into black, while distorting skin channel ratios $(R^{2.2} : G^{2.2} : B^{2.2})$ into oversaturated burnt orange-brown.
   - In `gather.be-of-dao.com`, pixel colors are read directly in 8-bit **sRGB** space via 2D Canvas `getImageData` and boosted in sRGB space.
2. **Uniform Grid Waste vs. 2D Hilbert-Curve Importance Sampling (`W()` & `G(e)`)**:
   - A uniform `cols × rows` grid wasted ~60% of vertices on transparent cutout space (`gl_PointSize = 0.0`) and distributed the remaining points equally across flat regions and intricate facial features.
   - `gather.be-of-dao.com` traverses a $1024 \times 1024$ grid along a **2D Hilbert space-filling curve** and allocates all $N = 524,288$ ($2^{19}$) particles proportionally to an importance weight $B[a]$ driven by luminance, local edge gradient, and depth relief.
3. **Oversized `gl_PointSize` (`2.85` → `3.0–4.3px` blobs) vs. Sub-Pixel Micro-Grains (`~1.12–1.75px`)**:
   - Large overlapping points blurred adjacent features together and prevented sub-pixel `fade = min(1.0, sz / uMinPx)` attenuation from ever engaging.
4. **Silhouette White-Backdrop Halo**:
   - Semi-transparent and boundary pixels in `portrait-base-cutout.png` retained `[239, 240, 244]` white studio backdrop bleed, which after shadow boosting created a bright white outline around dark hair and shoulders.
5. **Mid-Face Drift Line & Foreground Harmonic Ripple**:
   - Placing the wind dissolution boundary near $x = +0.06$ pointing toward $-X$ dissolved the left eye, left glasses frame, and left cheek in front view, while applying sinusoidal depth waves directly to foreground vertices warped facial contours.

---

## 2. Non-Linear Guided Depth Map Pipeline ([`scripts/generate_depth.py`](file:///d:/portfolio/client/scripts/generate_depth.py))

[`generate_depth.py`](file:///d:/portfolio/client/scripts/generate_depth.py) packs 4 channels into [`client/public/portrait-depth.png`](file:///d:/portfolio/client/public/portrait-depth.png):

### A. Multi-Scale Luminance Relief (`near_rt`)
Computes perceptual luminance $I = 0.2126 R + 0.7152 G + 0.0722 B$ from `portrait-base.png` and applies two passes of separable 2D box blur (`boxblur`) with radius $r = \max(2, \text{round}(\max(W, H) / 36))$:
$$R_{\text{lum}} = \text{nt}\big(0.7 \cdot \text{boxblur}(\text{boxblur}(I, r), r) + 0.3 \cdot I\big)$$
where $\text{nt}(\cdot)$ normalizes between the 1st and 99th percentiles.

### B. FastDepth + Local Linear Guided Filter (`near_it`)
1. Runs the 224×224 `fastdepth.onnx` model (`1.0 / max(0.05, out)`) and suppresses the left-border convolution padding ramp.
2. Applies a **Guided Image Filter** using luminance $u = I$ as the full-resolution guide and normalized neural depth $h$ as the target over window radius $c = \max(2, \text{round}(\max(s, l) / 40))$:
   $$w = \frac{\text{cov}(u, h)}{\text{var}(u) + 0.0015}, \quad v = \bar{h} - w \bar{u}, \quad \text{near}_{\text{it}} = \text{nt}(\bar{w} \cdot I + \bar{v})$$

### C. Pure Foreground Relief + Background Ribbon Wave
Combines the guided neural depth and luminance relief in `gather.be-of-dao.com`'s exact ratio:
$$\text{near}_{\text{base}} = 0.65 \cdot \text{near}_{\text{it}} + 0.35 \cdot \text{near}_{\text{rt}}$$
The multi-harmonic spatial wave is masked by `bg_weight = 1.0 - clip(cut_alpha * 1.25, 0, 1)` so the foreground face remains 100% distortion-free while the background depth sheet forms an undulating organic ribbon when rotated to side profile.

---

## 3. 2D Hilbert-Curve Importance Sampling & Micro-Grain Shader ([`ParticleDepthPortrait.tsx`](file:///d:/portfolio/client/src/components/ParticleDepthPortrait.tsx))

### A. 2D Hilbert Curve & Balanced Importance Density (`getHilbertTable` & `B[a]`)
- **Hilbert Lookup Table (`1024 × 1024`)**: Maps 1D index $idx \in [0, 1048575]$ to 2D coordinates $(x, y)$ preserving spatial locality.
- **4px Inward Silhouette Halo Suppression**: For foreground pixels within 4 pixels of the cutout boundary (`minNeighborAlpha < 0.92`), RGB values are sampled 5 pixels inward toward the portrait center, completely eliminating white studio backdrop fringes around hair and shoulders.
- **Balanced Cutout Importance Weight**:
  $$B[a] = \big(0.22 + 0.50 \cdot I^{0.6} + 0.75 \cdot G_{\text{edge}} (0.35 + 0.65 I)\big)(0.45 + 0.55 \cdot \text{nearVal}) \cdot \alpha_{\text{cut}}$$
  This allocates ~1.34 grains per $1024 \times 1024$ cell on facial skin and high-gradient features (eyes, glasses rims, nostrils, lips) and ~0.70 grains per cell on dark hair, beard, and hoodie folds across all $N = 524,288$ ($2^{19}$) particles.
- **True sRGB Color Boost**:
  $$\text{boost} = 1.0 + 0.85 \cdot \left(\min\left(\frac{1}{0.1 + 0.9 \cdot I}, \frac{1}{\max(R,G,B)}\right) - 1.0\right)$$

### B. Sub-Pixel Micro-Grain Sizing & Energy Calibration
- Base grain size $k$ and energy gain $T$ scale automatically with viewport height and device pixel ratio (`dpr`):
  $$k = \text{clamp}\!\left(b \sqrt{\frac{0.6}{N}} \cdot 1.45,\; 1.12 \cdot \text{dpr},\; 1.85 \cdot \text{dpr}\right), \quad E = \frac{N \cdot 0.35 k^2}{0.38 b^2}, \quad T = \text{clamp}\!\left(\frac{0.72}{E + 0.12},\; 0.12,\; 0.48\right)$$
- In the vertex shader, grains smaller than `uMinPx = 1.0` clamp to `1.0px` and attenuate their energy by $\text{fade}^2 = (\min(1.0, \text{sz} / \text{uMinPx}))^2$, producing crisp sub-pixel photographic sand grains with subtle dark micro-spaces between particles.

### C. Right-Edge Ragged Dissolution & Pointer Smoke Wake (`uBrush[6]`)
- **Right-Edge Ragged Drift**: The wavering drift line is anchored at $x_0 = +0.24$ with normal $\mathbf{n} = (+0.9889, -0.1488)$ so the entire central face (both eyes, glasses, nose, lips) remains 100% intact while sand grains detach and swirl off the right edge through the 3D `flow(q, t)` field.
- **Pointer Wake (`uBrush[6]`)**: Moving the cursor across the portrait records a 6-point velocity wake with bi-exponential envelope $(1 - e^{-\Delta t / 0.05}) e^{-\Delta t / 0.75}$ that parts nearby sand grains in screen space like a hand moving through smoke.

---

## 4. 3D Lamp Flash & Particle Reflection System (`LIGHT` Button / `S` Key)

1. **3-Lamp Pool & Bi-Exponential Envelope**:
   - Cycles through 3 independent 3D lamps (`lamps[0..2]`) with fast attack ($\tau_{\text{rise}} = 0.018\text{ s}$) and slow decay ($\tau_{\text{decay}} = 0.45\text{ s}$).
2. **Inverse-Square 3D Particle Illumination (`lit`)**:
   $$\text{lit} = \sum_{k=0}^{2} \frac{L_k}{1.0 + 3.2 \cdot \|\mathbf{p} - \mathbf{p}_{\text{lamp},k}\|^2}$$
3. **Grain Swell & Chiaroscuro Reflection**:
   - Illuminated grains expand by `1.0 + 0.5 * min(1.0, lit)` and reflect warm `#ffe9c4` light at `2.7x` intensity while unlit ambient grains subtly step back by `1.0 - 0.5 * uLampSum`.
   - Each active lamp projects a `LIGHT` telemetry bracket, soft radial dust glow, and 3 dynamic SVG proximity links to the nearest portrait tracking nodes.
