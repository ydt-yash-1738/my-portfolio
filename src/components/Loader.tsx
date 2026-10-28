import React, { useEffect, useRef, useState } from 'react';

const PRELOAD_IMAGES = ['/portrait-base-cutout.png', '/marquez-reveal-4k.png'];
const MIN_VISIBLE_MS = 1000;
const MAX_WAIT_MS = 12000;

/** Full-screen loading bar that tracks real asset loading (fonts, page load, hero images, and preview iframes). */
export const Loader: React.FC = () => {
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const done = useRef(0);

  useEffect(() => {
    // live-site preview iframes are part of 'everything'; they flag themselves via data-loaded
    const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe.bf-iframe'));
    const total = PRELOAD_IMAGES.length + 2 + frames.length;
    done.current = 0; // reset so React StrictMode's double effect run doesn't double count
    const start = performance.now();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const tick = () => {
      done.current += 1;
    };
    const finishedOnce = new Set<string>();
    const mark = (key: string) => {
      if (finishedOnce.has(key)) return;
      finishedOnce.add(key);
      tick();
    };

    // 1) Fonts readiness
    document.fonts?.ready.then(() => mark('fonts')).catch(() => mark('fonts'));

    // 2) Document completion
    if (document.readyState === 'complete') mark('load');
    else window.addEventListener('load', () => mark('load'), { once: true });

    // 3) Core hero assets
    PRELOAD_IMAGES.forEach((src) => {
      const img = new Image();
      img.onload = img.onerror = () => mark(src);
      img.src = src;
    });

    // 4) Live-site preview iframes
    frames.forEach((frame, idx) => {
      const key = `frame-${idx}`;
      if (frame.dataset.loaded === '1') {
        mark(key);
      } else {
        const onFrameDone = () => mark(key);
        frame.addEventListener('load', onFrameDone, { once: true });
        frame.addEventListener('error', onFrameDone, { once: true });
        // Fallback safety timeout per frame (8s) so an external host downtime won't stall the loader forever
        window.setTimeout(onFrameDone, 8000);
      }
    });

    let shown = 0;
    let raf = 0;
    let finished = false;
    const loop = () => {
      const timedOut = performance.now() - start > MAX_WAIT_MS;
      const framesDoneCount = frames.filter((f) => f.dataset.loaded === '1').length;
      // Count loaded items including frames
      const progressCount = Math.max(done.current, (done.current - frames.length) + framesDoneCount);
      const target = timedOut ? 100 : Math.min(100, (progressCount / Math.max(1, total)) * 100);

      // ease toward the real progress so the bar always moves smoothly
      shown += (target - shown) * 0.12;
      if (target - shown < 0.4) shown = target;
      setPct(shown);

      const minElapsed = performance.now() - start > MIN_VISIBLE_MS;
      if (shown >= 100 && minElapsed && !finished) {
        finished = true;
        setLeaving(true);
        document.body.style.overflow = prevOverflow;
        window.setTimeout(() => {
          setGone(true);
          window.dispatchEvent(new Event('resize')); // let scroll animations re-measure
        }, 900);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (gone) return null;

  const value = Math.round(pct);
  return (
    <div
      className={`site-loader ${leaving ? 'is-leaving' : ''}`}
      role="progressbar"
      aria-label="Loading site"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <div className="loader-inner">
        <div className="loader-top">
          <span className="loader-brand">YASH</span>
          <span className="loader-percent">{String(value).padStart(3, '0')}</span>
        </div>
        <div className="loader-track">
          <div className="loader-fill" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <div className="loader-bottom">
          <span>LOADING PORTFOLIO</span>
          <span>FULL-STACK // FREELANCE</span>
        </div>
      </div>
    </div>
  );
};

export default Loader;
