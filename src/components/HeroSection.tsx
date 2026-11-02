import React, { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen, Sparkles, Image as ImageIcon, SunMedium, Zap, RotateCcw, Upload } from 'lucide-react';
import LorenzoInteractivePortrait from './LorenzoInteractivePortrait';
import ParticleDepthPortrait from './ParticleDepthPortrait';
import { generateUserPortraitDepth } from '../utils/generateUserDepth';

export const HeroSection: React.FC = () => {
  const [locked, setLocked] = useState(false);
  const [isParticleMode, setIsParticleMode] = useState(false);
  const [customPortrait, setCustomPortrait] = useState<{
    imageSrc: string;
    depthSrc: string;
    fileName?: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  const [generationError, setGenerationError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Effective lock state: locked if manually toggled, OR automatically whenever custom portrait is active in 3D mode
  const isLockedEffective = locked || (isParticleMode && Boolean(customPortrait));

  // Freeze page scroll when locked or viewing custom 3D portrait
  useEffect(() => {
    if (!isLockedEffective) return;

    const html = document.documentElement;
    const body = document.body;
    html.classList.add('hero-scroll-locked');
    body.classList.add('hero-scroll-locked');
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    // tell the smooth-scroller to scroll to the hero and freeze (it ignores overflow:hidden)
    window.dispatchEvent(new CustomEvent('hero-lock', { detail: true }));
    window.scrollTo({ top: 0, behavior: 'instant' });

    // block wheel / touch scrolling everywhere while frozen (except inside interactive buttons)
    const block = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.('button, a, input, [data-lenis-prevent]')) return;
      if (e.cancelable) {
        e.preventDefault();
      }
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
      html.classList.remove('hero-scroll-locked');
      body.classList.remove('hero-scroll-locked');
      html.style.overflow = '';
      body.style.overflow = '';
      window.dispatchEvent(new CustomEvent('hero-lock', { detail: false }));
      window.removeEventListener('wheel', block);
      window.removeEventListener('touchmove', block);
      window.removeEventListener('keydown', keys);
    };
  }, [isLockedEffective]);

  const handleTryYourselfClick = () => {
    // 1. Remain squarely in hero section
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // 2. Lock scroll down
    setLocked(true);
    // 3. Switch to 3D particle mode
    setIsParticleMode(true);
    // 4. Open native file / gallery picker
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset value so re-selecting same file triggers change
    e.target.value = '';

    // Remain in hero section and lock scroll down
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setLocked(true);
    setIsParticleMode(true);
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationStatus('INITIALIZING...');

    try {
      const assets = await generateUserPortraitDepth(file, (status) => {
        setGenerationStatus(status);
      });

      setCustomPortrait({
        imageSrc: assets.imageSrc,
        depthSrc: assets.depthSrc,
        fileName: file.name,
      });
      setIsGenerating(false);
    } catch (err: any) {
      console.error('Portrait depth processing failed:', err);
      setGenerationError(err?.message || 'Failed to process image.');
      setIsGenerating(false);
    }
  };

  const handleResetPortrait = () => {
    setCustomPortrait(null);
    setLocked(false);
    setGenerationError(null);
  };

  // Only hide portfolio branding & text when actively viewing a custom portrait in 3D particle mode.
  // In 2D view on the white theme, the portfolio hero text and branding are always visible!
  const hidePortfolioText = isParticleMode && Boolean(customPortrait);

  return (
    <section
      className={`hero-stage ${isLockedEffective ? 'is-locked' : ''} ${isParticleMode ? 'is-particle-mode' : ''} ${
        hidePortfolioText ? 'has-custom-portrait' : ''
      }`}
    >
      {/* ── NAVBAR (NAME ON LEFT, HIDDEN ONLY IN 3D CUSTOM USER MODE) ── */}
      {!hidePortfolioText && (
        <nav className="minimal-navbar">
          <a href="#top" className="navbar-name">
            YASH
          </a>
        </nav>
      )}

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
          onClick={() => {
            setIsParticleMode((v) => !v);
            setLocked(false);
          }}
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
              <span>GOING DARK</span>
            </>
          )}
        </button>
      </div>

      {/* ── CANVAS LAYER: EITHER 2D INTERACTIVE REVEAL OR 3D PARTICLE DEPTH ── */}
      <div className="hero-canvas-layer">
        {isParticleMode ? (
          <ParticleDepthPortrait
            imageSrc={customPortrait ? customPortrait.imageSrc : "/portrait-base-cutout.png"}
            depthSrc={customPortrait ? customPortrait.depthSrc : "/portrait-depth.png"}
            titleTag={customPortrait ? "USER //" : "X"}
            onClose={() => setIsParticleMode(false)}
            isLocked={isLockedEffective}
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

      {/* ── LEFT & RIGHT SIDE EDITORIAL HERO TEXT (HIDDEN ONLY IN 3D CUSTOM USER MODE) ── */}
      {!hidePortfolioText && (
        <div className="hero-side-overlays" aria-hidden="false">
          {/* Left Side */}
          <div className="hero-side hero-side-left">
            <div className="hero-editorial-block">
              <span className="hero-eyebrow">01 // INDEPENDENT DEVELOPER</span>
              <h1 className="hero-side-title">
                CREATIVE DEV
                <br />
                &amp; ARCHITECT
              </h1>
              <p className="hero-side-desc">
                Building high-performance web applications, cloud infrastructure &amp;
                scalable production systems.
              </p>
            </div>

            {/* Lando Norris-inspired lower-left technical badge card */}
            <div className="hero-spec-card">
              <div className="spec-card-header">ENGINEERING &amp; PROJECTS</div>
              <div className="spec-card-body">
                <div className="spec-stack-line">REACT • NODE • FASTAPI</div>
                <div className="spec-divider" />
                <div className="spec-sub">
                  AZURE CLOUD &amp; CI/CD
                  <br />
                  PRODUCTION SYSTEMS
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
                <>
                  <span className="scroll-cue-text particle-cue-text">
                    {locked ? 'DRAG TO ROTATE 3D' : 'DRAG TO ROTATE · SCROLL FOR BIO'}
                  </span>
                  {!locked && <span className="scroll-cue-line" />}
                </>
              ) : (
                <>
                  <span className="scroll-cue-text">SCROLL FOR BIO &amp; WORKS</span>
                  <span className="scroll-cue-line" />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile-only bottom controls: Lock toggle and 3D Particle Lightning action */}
      <div className="hero-bottom-controls">
        <button
          type="button"
          className={`hero-lock-btn ${isLockedEffective ? 'is-locked' : ''}`}
          onClick={() => setLocked((v) => !v)}
          aria-pressed={isLockedEffective}
          aria-label={isLockedEffective ? 'Unlock scrolling' : 'Lock hero to interact'}
        >
          {isLockedEffective ? <Lock size={14} /> : <LockOpen size={14} />}
          <span>{isLockedEffective ? 'LOCKED' : 'LOCK'}</span>
        </button>

        {isParticleMode && (
          <button
            type="button"
            className="hero-mobile-light-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('trigger-node-flash'))}
            title="Flash Scene Lighting & Telemetry Sensors"
            aria-label="Flash Lighting"
          >
            <Zap size={14} className="mobile-light-icon" />
          </button>
        )}
      </div>

      {/* ── BOTTOM RIGHT: "TRY YOURSELF" / USER UPLOAD PORTRAIT ACTION (ONLY IN 3D PARTICLE MODE) ── */}
      {isParticleMode && (
        <div className="hero-try-yourself-container">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {isGenerating ? (
            <div className="hero-try-generating-badge" aria-live="polite">
              <span className="try-generating-spinner" />
              <span className="try-generating-text">
                {generationStatus || 'COMPUTING 3D DEPTH...'}
              </span>
            </div>
          ) : customPortrait ? (
            <div className="hero-custom-actions">
              <button
                type="button"
                className="hero-try-btn is-custom"
                onClick={handleTryYourselfClick}
                title="Upload another portrait from gallery or files"
              >
                <Upload size={13} className="try-sparkle-icon" />
                <span className="try-custom-text-full">TRY ANOTHER</span>
                <span className="try-custom-text-mobile">ANOTHER</span>
              </button>
              <button
                type="button"
                className="hero-reset-portrait-btn"
                onClick={handleResetPortrait}
                title="Reset to Yash original 3D portrait"
                aria-label="Reset portrait"
              >
                <RotateCcw size={13} className="reset-icon" />
                <span className="reset-btn-text">RESET</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="hero-try-btn"
              onClick={handleTryYourselfClick}
              title="Upload your own photo to generate a 3D Sand Particle Depth Portrait"
            >
              <Sparkles size={14} className="try-sparkle-icon" />
              <span>TRY YOURSELF</span>
            </button>
          )}

          {generationError && (
            <div className="hero-try-error-toast" onClick={() => setGenerationError(null)}>
              <span>{generationError}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default HeroSection;
