import React from 'react';
import LorenzoInteractivePortrait from './LorenzoInteractivePortrait';

export const HeroSection: React.FC = () => {
  return (
    <section className="hero-stage">
      {/* ── NAVBAR (ONLY NAME ON THE LEFT) ── */}
      <nav className="minimal-navbar">
        <a href="#top" className="navbar-name">
          YASH
        </a>
      </nav>

      {/* ── THREE.JS INTERACTIVE PORTRAIT CANVAS (WITH SLOW-MOVING CONTOUR BG) ── */}
      <div className="hero-canvas-layer">
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
      </div>

      {/* ── LEFT & RIGHT SIDE EDITORIAL HERO TEXT ── */}
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

          <div className="hero-scroll-cue">
            <span className="scroll-cue-text">SCROLL FOR BIO &amp; WORKS</span>
            <span className="scroll-cue-line" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
