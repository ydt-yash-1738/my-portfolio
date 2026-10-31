import React, { useEffect, useState } from 'react';
import { Lock, LockOpen, Sparkles, Image as ImageIcon, SunMedium } from 'lucide-react';
import LorenzoInteractivePortrait from './LorenzoInteractivePortrait';
import ParticleDepthPortrait from './ParticleDepthPortrait';

export const HeroSection: React.FC = () => {
  const [locked, setLocked] = useState(false);
  const [isParticleMode, setIsParticleMode] = useState(false);

  // Freeze page scroll when locked (mobile) OR when interacting with the 3D particle depth portrait
  useEffect(() => {
    const shouldFreeze = locked || isParticleMode;
    if (!shouldFreeze) return;

    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // tell the smooth-scroller to scroll to the hero and freeze (it ignores overflow:hidden)
    window.dispatchEvent(new CustomEvent('hero-lock', { detail: true }));

    // block wheel / touch scrolling everywhere while frozen (except inside modals)
    const block = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-lenis-prevent]')) return;
      e.preventDefault();
    };
    const opts = { passive: false } as AddEventListenerOptions;
    window.addEventListener('wheel', block, opts);
    window.addEventListener('touchmove', block, opts);

    const keys = (e: KeyboardEvent) => {
      if ([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'End', 'Home'].includes(e.key)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', keys);

    return () => {
      window.dispatchEvent(new CustomEvent('hero-lock', { detail: false }));
      window.removeEventListener('wheel', block);
      window.removeEventListener('touchmove', block);
      window.removeEventListener('keydown', keys);
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, [locked, isParticleMode]);

  return (
    <section className={`hero-stage ${locked ? 'is-locked' : ''} ${isParticleMode ? 'is-particle-mode' : ''}`}>
      {/* ── NAVBAR (NAME ON LEFT) ── */}
      <nav className="minimal-navbar">
        <a href="#top" className="navbar-name">
          YASH
        </a>
      </nav>

      {/* ── TOP RIGHT: 3D PARTICLE DEPTH & LIGHT ACTION BUTTONS ── */}
      <div className="hero-top-actions">
        {isParticleMode && (
          <button
            type="button"
            className="hero-light-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('trigger-node-flash'))}
            title="Flash Scene Lighting & Telemetry Sensors"
            aria-label="Flash Light"
          >
            <SunMedium size={14} className="light-icon" />
            <span>LIGHT</span>
          </button>
        )}

        <button
          type="button"
          className={`hero-particle-toggle ${isParticleMode ? 'is-active' : ''}`}
          onClick={() => setIsParticleMode((v) => !v)}
          aria-pressed={isParticleMode}
          title={isParticleMode ? 'Return to 2D portrait' : 'Explore 3D Particle Depth'}
        >
          {isParticleMode ? (
            <>
              <ImageIcon size={14} className="particle-toggle-icon" />
              <span>2D VIEW</span>
            </>
          ) : (
            <>
              <Sparkles size={14} className="particle-toggle-icon" />
              <span>3D PARTICLES</span>
            </>
          )}
        </button>
      </div>

      {/* ── CANVAS LAYER: EITHER 2D INTERACTIVE REVEAL OR 3D PARTICLE DEPTH ── */}
      <div className="hero-canvas-layer">
        {isParticleMode ? (
          <ParticleDepthPortrait
            imageSrc="/portrait-base-cutout.png"
            depthSrc="/portrait-depth.png"
            onClose={() => setIsParticleMode(false)}
          />
        ) : (
          <LorenzoInteractivePortrait
            baseImageUrl="/portrait-base-cutout.png"
            revealImageUrl="/marquez-reveal-4k.png"
            backgroundColor="#FFFFFF"
            blobRadius={0.15}
            blobFadeSpeed={0.9}
            colorBgVec3="1.0, 1.0, 1.0"
            colorSoftShapeVec3="0.961, 0.961, 0.961"
            colorLineVec3="0.89, 0.89, 0.89"
          />
        )}
      </div>

      {/* ── LEFT & RIGHT SIDE EDITORIAL HERO TEXT (STAYS AS IS, TURNS WHITE) ── */}
      <div className="hero-side-overlays" aria-hidden="false">
        {/* Left Side */}
        <div className="hero-side hero-side-left">
          <div className="hero-editorial-block">
            <span className="hero-eyebrow">01 // FULL-STACK ENGINEER</span>
            <h1 className="hero-side-title">
              CREATIVE DEV
              <br />
              &amp; ARCHITECT
            </h1>
            <p className="hero-side-desc">
              Building high-performance web applications, cloud infrastructure &amp;
              production client platforms.
            </p>
          </div>

          {/* Lando Norris-inspired lower-left technical badge card */}
          <div className="hero-spec-card">
            <div className="spec-card-header">FREELANCE &amp; CORE</div>
            <div className="spec-card-body">
              <div className="spec-stack-line">REACT • NODE • FASTAPI</div>
              <div className="spec-divider" />
              <div className="spec-sub">
                AZURE CLOUD &amp; CI/CD
                <br />
                FULL-STACK SYSTEMS
              </div>
            </div>
          </div>
        </div>

        {/* Right Side */}
        <div className="hero-side hero-side-right">
          <div className="hero-editorial-block align-right">
            <span className="hero-eyebrow">02 // DATA &amp; CLOUD</span>
            <h2 className="hero-side-title">
              SCALABLE
              <br />
              SYSTEMS
            </h2>
            <p className="hero-side-desc">
              CosmosDB • MongoDB • PostgreSQL
              <br />
              End-to-end production delivery.
            </p>
          </div>

          {/* Bottom hint or cue */}
          <div className="hero-scroll-cue">
            {isParticleMode ? (
              <span className="scroll-cue-text particle-cue-text">DRAG TO ROTATE 3D · CLICK LIGHT TO FLASH</span>
            ) : (
              <>
                <span className="scroll-cue-text">SCROLL FOR BIO &amp; WORKS</span>
                <span className="scroll-cue-line" />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile-only lock toggle (only shown in 2D mode, as particle mode auto-locks) */}
      {!isParticleMode && (
        <button
          type="button"
          className={`hero-lock-btn ${locked ? 'is-locked' : ''}`}
          onClick={() => setLocked((v) => !v)}
          aria-pressed={locked}
          aria-label={locked ? 'Unlock scrolling' : 'Lock hero to interact'}
        >
          {locked ? <Lock size={15} /> : <LockOpen size={15} />}
          <span>{locked ? 'LOCKED · DRAG TO PLAY' : 'LOCK TO PLAY'}</span>
        </button>
      )}
    </section>
  );
};

export default HeroSection;
