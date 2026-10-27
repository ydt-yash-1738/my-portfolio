import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Mail, Phone, X } from 'lucide-react';

const EMAIL = 'yashdt50@gmail.com';
const PHONE_DISPLAY = '+91 63931 15243';
const PHONE_RAW = '+916393115243';

/** Any element can open the modal with: window.dispatchEvent(new Event('open-contact')) */
export const ContactButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('open-contact', onOpen);
    return () => window.removeEventListener('open-contact', onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      lastFocus.current?.focus?.();
    };
  }, [open, close]);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      /* clipboard unavailable: the mailto/tel links still work */
    }
  };

  return (
    <>
      <button type="button" className="contact-fab" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="contact-fab-dot" />
        CONTACT
      </button>

      <div
        className={`contact-overlay ${open ? 'is-open' : ''}`}
        onClick={close}
        data-lenis-prevent
        aria-hidden={!open}
      >
        <div
          className="contact-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Contact details"
          onClick={(e) => e.stopPropagation()}
        >
          <button ref={closeRef} type="button" className="contact-close" onClick={close} aria-label="Close contact">
            <X size={18} />
          </button>

          <span className="contact-eyebrow">// GET IN TOUCH</span>
          <h3 className="contact-title">
            Let&apos;s build something <span className="accent-red">together.</span>
          </h3>
          <p className="contact-sub">Available for freelance projects and full-stack roles. Typically replies within a day.</p>

          <div className="contact-rows">
            <div className="contact-row">
              <a className="contact-link" href={`mailto:${EMAIL}`} tabIndex={open ? 0 : -1}>
                <span className="contact-icon"><Mail size={18} /></span>
                <span className="contact-text">
                  <span className="contact-label">EMAIL</span>
                  <span className="contact-value">{EMAIL}</span>
                </span>
                <ArrowUpRight size={18} className="contact-arrow" />
              </a>
              <button
                type="button"
                className="contact-copy"
                onClick={() => copy('email', EMAIL)}
                aria-label="Copy email"
                tabIndex={open ? 0 : -1}
              >
                {copied === 'email' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>

            <div className="contact-row">
              <a className="contact-link" href={`tel:${PHONE_RAW}`} tabIndex={open ? 0 : -1}>
                <span className="contact-icon"><Phone size={18} /></span>
                <span className="contact-text">
                  <span className="contact-label">PHONE</span>
                  <span className="contact-value">{PHONE_DISPLAY}</span>
                </span>
                <ArrowUpRight size={18} className="contact-arrow" />
              </a>
              <button
                type="button"
                className="contact-copy"
                onClick={() => copy('phone', PHONE_RAW)}
                aria-label="Copy phone number"
                tabIndex={open ? 0 : -1}
              >
                {copied === 'phone' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          <span className="contact-toast" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
        </div>
      </div>
    </>
  );
};

export default ContactButton;
