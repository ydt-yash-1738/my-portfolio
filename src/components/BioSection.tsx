import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import {
  ArrowUpRight,
  Code2,
  Server,
  Cloud,
  Database,
  GitBranch,
  Layers,
  Sparkles,
  Zap,
  Globe,
} from 'lucide-react';

interface TechItem {
  name: string;
  category: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
}

const DB_TECH = 'CosmosDB • MongoDB • PostgreSQL';

const TECH_STACK: TechItem[] = [
  {
    name: 'ReactJS',
    category: 'FRONTEND ARCHITECTURE',
    description: 'Interactive interfaces, custom hooks, state management, and high-frame-rate web experiences.',
    icon: <Code2 size={20} />,
    accent: '#61DAFB',
  },
  {
    name: 'NodeJS',
    category: 'BACKEND RUNTIME',
    description: 'Event-driven server architecture, scalable REST APIs, real-time sockets, and microservices.',
    icon: <Server size={20} />,
    accent: '#68A063',
  },
  {
    name: 'FastAPI',
    category: 'HIGH-SPEED PYTHON API',
    description: 'Asynchronous Python backends, automatic OpenAPI schemas, and ultra-low-latency endpoints.',
    icon: <Zap size={20} />,
    accent: '#009688',
  },
  {
    name: 'Full Stack',
    category: 'END-TO-END ENGINEERING',
    description: 'Complete product lifecycle from database modeling and API design to pixel-accurate frontend UI.',
    icon: <Layers size={20} />,
    accent: '#FF3B30',
  },
  {
    name: 'Azure',
    category: 'CLOUD INFRASTRUCTURE',
    description: 'Cloud-native deployments, App Services, serverless compute, storage, and managed cloud security.',
    icon: <Cloud size={20} />,
    accent: '#0089D6',
  },
  {
    name: 'CI/CD',
    category: 'DEVOPS & AUTOMATION',
    description: 'Automated testing, containerization, GitHub Actions workflows, and zero-downtime release pipelines.',
    icon: <GitBranch size={20} />,
    accent: '#F59E0B',
  },
  {
    name: 'CosmosDB • MongoDB • PostgreSQL',
    category: 'DATA & PERSISTENCE',
    description: 'Multi-model database engineering across globally distributed NoSQL, document stores, and relational SQL.',
    icon: <Database size={20} />,
    accent: '#A855F7',
  },
];

interface ProjectItem {
  index: string;
  title: string;
  domain: string;
  url: string;
  status: string;
  description: string;
  tags: string[];
  isLive: boolean;
}

const PROJECTS: ProjectItem[] = [
  {
    index: '01',
    title: 'Clinic Rhinoplasty',
    domain: 'clinicrhinoplasty.com',
    url: 'https://clinicrhinoplasty.com',
    status: 'LIVE PRODUCTION',
    description:
      'Production healthcare and aesthetic surgery digital platform engineered for fast load performance, responsive clinical presentation, SEO visibility, and streamlined patient inquiries.',
    tags: ['Full Stack', 'ReactJS', 'Responsive UI', 'Production'],
    isLive: true,
  },
  {
    index: '02',
    title: 'Manuraj Traders',
    domain: 'manuraj-traders.vercel.app',
    url: 'https://manuraj-traders.vercel.app',
    status: 'LIVE DEPLOYMENT',
    description:
      'Modern commercial trading and enterprise catalog web application featuring clean product discovery, fast edge delivery, and intuitive business workflows.',
    tags: ['ReactJS', 'NodeJS', 'CI/CD', 'Vercel Edge'],
    isLive: true,
  },
  {
    index: '03',
    title: 'Upcoming Client & Cloud Builds',
    domain: 'More Undergoing',
    url: '#projects',
    status: 'IN DEVELOPMENT',
    description:
      'Multiple freelance and full-stack platforms currently under active development—spanning FastAPI backends, Azure cloud deployments, and CosmosDB / PostgreSQL data architectures.',
    tags: ['FastAPI', 'Azure', 'CosmosDB', 'PostgreSQL'],
    isLive: false,
  },
];

const FLIP_WORDS = ['REACTJS', 'NODEJS', 'FASTAPI', 'FULL STACK', 'AZURE CLOUD', 'CI/CD', 'COSMOSDB', 'MONGODB', 'POSTGRESQL'];

/* ── Interaction helpers ── */
const GLYPHS = '!<>-_\\/[]{}=+*^?#01';

/** Text that scrambles into place on hover / when scrolled into view. */
const ScrambleText: React.FC<{ text: string; className?: string; active?: boolean }> = ({ text, className, active }) => {
  const [out, setOut] = useState(text);
  const raf = useRef<number | null>(null);

  const run = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    let frame = 0;
    const total = 22;
    const tick = () => {
      frame++;
      const reveal = Math.floor((frame / total) * text.length);
      setOut(
        text
          .split('')
          .map((ch, i) =>
            ch === ' ' || i < reveal ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          )
          .join('')
      );
      if (frame < total) raf.current = requestAnimationFrame(tick);
      else setOut(text);
    };
    tick();
  };

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  // re-run the scramble whenever the parent flags it active (auto-pulse)
  useEffect(() => {
    if (active) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <span className={className} onMouseEnter={run} data-scramble>
      {out}
    </span>
  );
};

/** Cursor-tracked spotlight (+ optional 3D tilt) via CSS variables. */
const trackPointer = (e: React.MouseEvent<HTMLElement>, tilt = false) => {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  el.style.setProperty('--mx', `${x}px`);
  el.style.setProperty('--my', `${y}px`);
  if (tilt) {
    el.style.setProperty('--ry', `${((x / r.width) - 0.5) * 10}deg`);
    el.style.setProperty('--rx', `${(0.5 - y / r.height) * 10}deg`);
  }
};

const resetTilt = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.setProperty('--rx', '0deg');
  e.currentTarget.style.setProperty('--ry', '0deg');
};

/** Pulls an element slightly toward the cursor. */
const magnet = (e: React.MouseEvent<HTMLElement>, strength = 0.35) => {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--tx', `${(e.clientX - (r.left + r.width / 2)) * strength}px`);
  el.style.setProperty('--ty', `${(e.clientY - (r.top + r.height / 2)) * strength}px`);
};
const unmagnet = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.setProperty('--tx', '0px');
  e.currentTarget.style.setProperty('--ty', '0px');
};

const HEADLINE: { w: string; accent?: boolean }[] = [
  ...'Full-Stack Engineer &'.split(' ').map((w) => ({ w })),
  ...'Freelance Developer'.split(' ').map((w) => ({ w, accent: true })),
  ...'building high-velocity web platforms and cloud-native backends.'.split(' ').map((w) => ({ w })),
];

const KEYWORDS: { label: string; tech: string }[] = [
  { label: 'ReactJS', tech: 'ReactJS' },
  { label: 'NodeJS', tech: 'NodeJS' },
  { label: 'FastAPI', tech: 'FastAPI' },
  { label: 'CI/CD', tech: 'CI/CD' },
  { label: 'Microsoft Azure', tech: 'Azure' },
  { label: 'CosmosDB', tech: DB_TECH },
  { label: 'MongoDB', tech: DB_TECH },
  { label: 'PostgreSQL', tech: DB_TECH },
];

export const BioSection: React.FC = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const [activeTech, setActiveTech] = useState<string | null>(null);
  const [metricPulse, setMetricPulse] = useState(-1);
  const [flipIdx, setFlipIdx] = useState(0);

  // replay the metric hover animation automatically every 5 seconds (staggered)
  useEffect(() => {
    const timers: number[] = [];
    const id = window.setInterval(() => {
      [0, 1, 2].forEach((i) => {
        timers.push(window.setTimeout(() => setMetricPulse(i), i * 500));
      });
      timers.push(window.setTimeout(() => setMetricPulse(-1), 3 * 500 + 700));
    }, 5000);
    return () => {
      window.clearInterval(id);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  const [flipLeaving, setFlipLeaving] = useState(false);

  // flip the ticker word every 5 seconds
  useEffect(() => {
    let swap: number | undefined;
    const id = window.setInterval(() => {
      setFlipLeaving(true);
      swap = window.setTimeout(() => {
        setFlipIdx((i) => (i + 1) % FLIP_WORDS.length);
        setFlipLeaving(false);
      }, 380);
    }, 5000);
    return () => {
      window.clearInterval(id);
      if (swap) window.clearTimeout(swap);
    };
  }, []);

  const kw = (i: number) => (
    <span
      className="tech-keyword"
      tabIndex={0}
      onClick={() => {
        // touch devices have no hover: tap to highlight the matching card briefly
        setActiveTech(KEYWORDS[i].tech);
        window.setTimeout(() => setActiveTech(null), 2400);
      }}
      onMouseEnter={() => setActiveTech(KEYWORDS[i].tech)}
      onMouseLeave={() => setActiveTech(null)}
      onFocus={() => setActiveTech(KEYWORDS[i].tech)}
      onBlur={() => setActiveTech(null)}
    >
      {KEYWORDS[i].label}
    </span>
  );
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
    );

    const elements = sectionRef.current?.querySelectorAll('.reveal-on-scroll');
    elements?.forEach((el) => observer.observe(el));

    const handleScroll = () => {
      const sec = sectionRef.current;
      if (sec) {
        const rect = sec.getBoundingClientRect();
        sec.style.setProperty('--parallax', `${-rect.top * 0.12}px`);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  /* ── Lando-Norris-style motion: Lenis smooth scroll + GSAP ScrollTrigger ── */
  useEffect(() => {
    const root = sectionRef.current;
    if (!root) return;
    gsap.registerPlugin(ScrollTrigger);
    // mobile browser toolbars resize the viewport while scrolling; don't re-layout pins on that\r
    ScrollTrigger.config({ ignoreMobileResize: true });

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const lenis = reduce ? null : new Lenis({ lerp: 0.085, smoothWheel: true });
    lenis?.on('scroll', ScrollTrigger.update);
    // hero lock (mobile): scroll to the hero, then freeze Lenis so the page can't move
    const onHeroLock = (e: Event) => {
      const locked = (e as CustomEvent<boolean>).detail;
      if (!lenis) {
        if (locked) window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (locked) lenis.scrollTo(0, { duration: 0.6, lock: true, onComplete: () => lenis.stop() });
      else lenis.start();
    };
    window.addEventListener('hero-lock', onHeroLock);
    const rafTick = (t: number) => lenis?.raf(t * 1000);
    gsap.ticker.add(rafTick);
    gsap.ticker.lagSmoothing(0);

    // Fit "LET'S BUILD" to its container exactly, whatever the font metrics are
    const cta = root.querySelector<HTMLElement>('.giant-cta');
    const fitCta = () => {
      const txt = cta?.querySelector<HTMLElement>('.giant-outline');
      if (!cta || !txt) return;
      cta.style.fontSize = '100px';
      const w = txt.offsetWidth || 1; // offsetWidth ignores the scroll scale transform
      const avail = cta.clientWidth;
      cta.style.fontSize = `${Math.min(100 * (avail / w) * 0.97, 220)}px`;
    };
    fitCta();
    document.fonts?.ready.then(fitCta);
    window.addEventListener('resize', fitCta);

    const mm = gsap.matchMedia();
    const ctx = gsap.context(() => {
      if (reduce) return;

      // Per-character headline reveals
      root.querySelectorAll<HTMLElement>('.block-heading').forEach((h) => {
        if (h.dataset.split) return;
        h.dataset.split = '1';
        const text = h.textContent || '';
        h.setAttribute('aria-label', text);
        // split per word first so lines only ever wrap between words, never mid-word
        h.innerHTML = text
          .split(' ')
          .map(
            (w) =>
              `<span class="word-nowrap" aria-hidden="true">${w
                .split('')
                .map((c) => `<span class="char-mask"><span class="char">${c}</span></span>`)
                .join('')}</span>`
          )
          .join(' ');
        gsap.from(h.querySelectorAll('.char'), {
          yPercent: 120,
          rotate: 8,
          duration: 0.9,
          ease: 'power4.out',
          stagger: 0.03,
          scrollTrigger: { trigger: h, start: 'top 88%' },
        });
      });

      // Giant CTA: outline text gets filled by scroll
      const fill = root.querySelector('.giant-fill');
      if (fill) {
        gsap.fromTo(
          fill,
          { clipPath: 'inset(0 100% 0 0)' },
          {
            clipPath: 'inset(0 0% 0 0)',
            ease: 'none',
            scrollTrigger: { trigger: '.giant-cta', start: 'top 96%', end: 'bottom 86%', scrub: 0.6 },
          }
        );
        gsap.from('.giant-cta', {
          scale: 0.86,
          ease: 'none',
          scrollTrigger: { trigger: '.giant-cta', start: 'top 100%', end: 'bottom 86%', scrub: true },
        });
      }

      // Project rows: parallax index + clip reveal
      gsap.utils.toArray<HTMLElement>('.project-row-card').forEach((row) => {
        gsap.from(row.querySelector('.project-index'), {
          y: 30,
          ease: 'none',
          scrollTrigger: { trigger: row, start: 'top bottom', end: 'bottom 40%', scrub: true },
        });
      });

      // Mobile / tablet: native swipe carousel with live counter
      mm.add('(max-width: 960px)', () => {
        const grid = root.querySelector<HTMLElement>('.tech-grid');
        if (!grid) return;
        grid.querySelectorAll('.tech-card').forEach((c) => c.classList.add('is-visible'));
        const total = TECH_STACK.length;
        const onScroll = () => {
          const max = grid.scrollWidth - grid.clientWidth || 1;
          const progress = Math.min(Math.max(grid.scrollLeft / max, 0), 1);
          const idx = Math.min(total, Math.round(progress * (total - 1)) + 1);
          if (counterRef.current) counterRef.current.textContent = String(idx).padStart(2, '0');
          if (lineRef.current) lineRef.current.style.transform = `scaleX(${progress})`;
        };
        grid.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => grid.removeEventListener('scroll', onScroll);
      });

      // Desktop: pin the tech stack and scroll it horizontally
      mm.add('(min-width: 961px)', () => {
        const block = root.querySelector<HTMLElement>('.stack-block');
        const grid = root.querySelector<HTMLElement>('.tech-grid');
        if (!block || !grid) return;
        const dist = () => Math.max(0, grid.scrollWidth - block.clientWidth);
        const total = TECH_STACK.length;
        gsap.to(grid, {
          x: () => -dist(),
          ease: 'none',
          scrollTrigger: {
            trigger: block,
            start: 'top 8%',
            end: () => `+=${dist() + window.innerHeight * 0.4}`,
            pin: true,
            pinSpacing: true,
            scrub: 0.6,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              const idx = Math.min(total, Math.round(self.progress * (total - 1)) + 1);
              if (counterRef.current) counterRef.current.textContent = String(idx).padStart(2, '0');
              if (lineRef.current) lineRef.current.style.transform = `scaleX(${self.progress})`;
            },
          },
        });
        // cards must be visible even when off-screen horizontally
        grid.querySelectorAll('.tech-card').forEach((c) => c.classList.add('is-visible'));
      });
    }, root);

    ScrollTrigger.refresh();
    // fonts / images change layout height; re-measure pins once they settle
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });

    return () => {
      mm.revert();
      window.removeEventListener('resize', fitCta);
      ctx.revert();
      gsap.ticker.remove(rafTick);
      window.removeEventListener('hero-lock', onHeroLock);
      lenis?.destroy();
    };
  }, []);

  return (
    <div ref={sectionRef} className="dark-bio-wrapper">
      {/* ── TRANSITION FROM WHITE HERO TO BLACK BIO SECTION ── */}
      <div className="section-transition-zone" aria-hidden="true">
<div className="transition-ticker-strip">
          <div className="flip-ticker">
            <span className="flip-label">BUILDING WITH</span>
            <span className="flip-window">
              <span key={flipIdx} className={`flip-word ${flipLeaving ? 'is-leaving' : 'is-entering'}`}>
                {FLIP_WORDS[flipIdx]}
              </span>
            </span>
            <span className="flip-star">{'\u2726'}</span>
            <span className="flip-count">
              {String(flipIdx + 1).padStart(2, '0')}/{String(FLIP_WORDS.length).padStart(2, '0')}
            </span>
          </div>
        </div>
      </div>

      {/* ── MAIN BLACK BIO & PORTFOLIO SECTION ── */}
      <section
        className="bio-section"
        onMouseMove={(e) => trackPointer(e)}
      >
        <div className="bio-cursor-spot" aria-hidden="true" />
        <div className="bio-ambient-glow glow-1" />
        <div className="bio-ambient-glow glow-2" />

        <div className="bio-container">
          {/* BIO INTRODUCTION */}
          <div className="bio-header-grid">
            <div className="bio-label-col reveal-on-scroll">
              <span className="section-index">01 // ABOUT & BIO</span>
              <div className="freelance-status-pill" onMouseMove={(e) => magnet(e, 0.3)} onMouseLeave={unmagnet}>
                <span className="live-dot" />
                <span>AVAILABLE FOR FREELANCE</span>
              </div>
            </div>

            <div className="bio-narrative-col">
              <h2 className="bio-headline reveal-on-scroll" aria-label="Full-Stack Engineer & Freelance Developer building high-velocity web platforms and cloud-native backends.">
                {HEADLINE.map((h, i) => (
                  <React.Fragment key={i}>
                    <span className="word-mask" aria-hidden="true">
                      <span
                        className={`word ${h.accent ? 'accent-red' : ''}`}
                        style={{ transitionDelay: `${i * 55}ms` }}
                      >
                        {h.w}
                      </span>
                    </span>
                    {i < HEADLINE.length - 1 ? ' ' : null}
                  </React.Fragment>
                ))}
              </h2>

              <p className="bio-subtext reveal-on-scroll">
                I architect and ship complete digital products from the ground up—combining
                responsive {kw(0)} frontends with high-throughput {kw(1)} and {kw(2)}{' '}
                services, automated {kw(3)} delivery on {kw(4)}, and resilient data layers
                across {kw(5)}, {kw(6)}, and {kw(7)}. Alongside core engineering, I partner
                directly with businesses as a freelance developer to deliver production websites
                that perform at scale.
              </p>

              <div className="bio-metrics-row reveal-on-scroll">
                <div className={`metric-box ${metricPulse === 0 ? 'is-auto' : ''}`} onMouseMove={(e) => trackPointer(e)}>
                  <span className="metric-val"><ScrambleText text="FULL-STACK" active={metricPulse === 0} /></span>
                  <span className="metric-lbl">UI to Cloud Infrastructure</span>
                </div>
                <div className={`metric-box ${metricPulse === 1 ? 'is-auto' : ''}`} onMouseMove={(e) => trackPointer(e)}>
                  <span className="metric-val"><ScrambleText text="AZURE + CI/CD" active={metricPulse === 1} /></span>
                  <span className="metric-lbl">Automated Cloud Delivery</span>
                </div>
                <div className={`metric-box ${metricPulse === 2 ? 'is-auto' : ''}`} onMouseMove={(e) => trackPointer(e)}>
                  <span className="metric-val"><ScrambleText text="FREELANCE" active={metricPulse === 2} /></span>
                  <span className="metric-lbl">Production Client Platforms</span>
                </div>
              </div>
            </div>
          </div>

          {/* TECH STACK — pinned horizontal scroll on desktop */}
          <div className="stack-block">
            <div className="block-title-row reveal-on-scroll">
              <div>
                <span className="section-index">02 // TECHNICAL ARSENAL</span>
                <h3 className="block-heading">CORE TECH STACK</h3>
              </div>
              <p className="block-caption">
                Production tools for scalable web apps, APIs, cloud infrastructure &amp; databases.
              </p>
            </div>

            <div className="tech-grid">
              {TECH_STACK.map((item, idx) => (
                <div
                  key={item.name}
                  className={`tech-card reveal-on-scroll ${
                    idx === TECH_STACK.length - 1 ? 'tech-card-wide' : ''
                  } ${activeTech === item.name ? 'is-linked' : ''}`}
                  style={
                    {
                      transitionDelay: `${(idx % 4) * 70}ms`,
                      '--accent': item.accent,
                    } as React.CSSProperties
                  }
                  onMouseMove={(e) => trackPointer(e, true)}
                  onMouseLeave={resetTilt}
                >
                  <div className="tech-card-top">
                    <span
                      className="tech-icon-wrap"
                      style={{
                        color: item.accent,
                        borderColor: `${item.accent}33`,
                        background: `${item.accent}12`,
                      }}
                    >
                      {item.icon}
                    </span>
                    <span className="tech-category">{item.category}</span>
                  </div>
                  <h4 className="tech-name">{item.name}</h4>
                  <p className="tech-desc">{item.description}</p>
                </div>
              ))}
            </div>
            <div className="stack-counter" aria-hidden="true">
              <span className="stack-counter-num" ref={counterRef}>01</span>
              <span className="stack-counter-total">/ {String(TECH_STACK.length).padStart(2, '0')}</span>
              <span className="stack-counter-line"><span ref={lineRef} /></span>
              <span className="stack-counter-hint">SCROLL →</span>
            </div>
          </div>

          {/* SELECTED FREELANCE WORKS */}
          <div id="projects" className="projects-block">
            <div className="block-title-row reveal-on-scroll">
              <div>
                <span className="section-index">03 // FREELANCE &amp; PRODUCTION</span>
                <h3 className="block-heading">SELECTED WORKS</h3>
              </div>
              <p className="block-caption">
                Shipped client platforms &amp; ongoing full-stack engineering builds.
              </p>
            </div>

            <div className="projects-list">
              {PROJECTS.map((project, idx) => (
                <a
                  key={project.title}
                  href={project.url}
                  target={project.isLive ? '_blank' : undefined}
                  rel={project.isLive ? 'noreferrer' : undefined}
                  className="project-row-card reveal-on-scroll"
                  style={{ transitionDelay: `${idx * 90}ms` }}
                  onMouseMove={(e) => trackPointer(e)}
                >
                  <div className="project-left">
                    <span className="project-index">{project.index}</span>
                    <div>
                      <div className="project-title-line">
                        <h4 className="project-title">{project.title}</h4>
                        <span
                          className={`project-status-badge ${
                            project.isLive ? 'badge-live' : 'badge-wip'
                          }`}
                        >
                          {project.isLive ? <Globe size={11} /> : <Sparkles size={11} />}
                          {project.status}
                        </span>
                      </div>
                      <span className="project-domain">{project.domain}</span>
                    </div>
                  </div>

                  <p className="project-description">{project.description}</p>

                  <div className="project-right">
                    <div className="project-tags">
                      {project.tags.map((t) => (
                        <span key={t} className="project-tag">
                          {t}
                        </span>
                      ))}
                    </div>
                    <div
                      className="project-arrow"
                      onMouseMove={(e) => magnet(e, 0.4)}
                      onMouseLeave={unmagnet}
                    >
                      <ArrowUpRight size={20} />
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* GIANT CTA — outline fills as you scroll */}
          <div className="giant-cta" aria-hidden="true">
            <span className="giant-outline">LET&apos;S BUILD</span>
            <span className="giant-fill">LET&apos;S BUILD</span>
          </div>

          <div className="cta-button-row">
            <button type="button" className="cta-contact-btn" onClick={() => window.dispatchEvent(new Event('open-contact'))}>
              <span>GET IN TOUCH</span>
              <ArrowUpRight size={18} />
            </button>
          </div>

          {/* FOOTER */}
          <footer className="bio-footer">
            <div className="footer-left">
              <span className="footer-brand">YASH</span>
              <span className="footer-copy">
                Full-Stack Developer &amp; Freelance Engineer
              </span>
            </div>
            <div className="footer-right">
              <a
                href="https://clinicrhinoplasty.com"
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                clinicrhinoplasty.com
              </a>
              <span className="footer-sep">/</span>
              <a
                href="https://manuraj-traders.vercel.app"
                target="_blank"
                rel="noreferrer"
                className="footer-link"
              >
                manuraj-traders.vercel.app
              </a>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
};

export default BioSection;
