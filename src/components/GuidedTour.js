import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import './GuidedTour.css';

const TOUR_SEEN_KEY = 'esovia_tour_seen';
const SPOT_PAD = 6;
const CARD_MARGIN = 16;
const CARD_GAP = 16;
const TARGET_WAIT_MS = 1500;

export function hasSeenTour() {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false; // storage blocked: just keep offering the tour
  }
}

function markTourSeen() {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // storage blocked: nothing to remember
  }
}

/* ----------------------------- steps ----------------------------- */

function buildSteps({ canWrite }) {
  const steps = [
    {
      id: 'welcome',
      title: 'Welcome to EsoVia',
      body: 'A short walkthrough of the main areas of the platform. You can run it again at any time from the top bar.',
    },
    {
      id: 'agreements',
      route: '/dashboard/agreements',
      target: 'nav-agreements',
      placement: 'right',
      title: 'Agreements',
      body: 'All your contracts in one place, from draft to activation. Open an agreement to review it, send it for approval or signature, and activate it.',
    },
  ];

  if (canWrite) {
    steps.push({
      id: 'create-agreement',
      route: '/dashboard/agreements',
      target: 'create-agreement',
      placement: 'bottom',
      title: 'Create an agreement',
      body: 'Start a new agreement from a template, by uploading a draft you negotiated offline, or by importing one that is already signed.',
    });
  }

  steps.push({
    id: 'accounts',
    route: '/dashboard/accounts',
    target: 'nav-accounts',
    placement: 'right',
    title: 'Accounts',
    body: 'The companies you work with. Open an account to see all of its agreements.',
  });

  if (canWrite) {
    steps.push({
      id: 'create-account',
      route: '/dashboard/accounts',
      target: 'create-account',
      placement: 'bottom',
      title: 'Add an account',
      body: 'Add an account before drafting its first agreement. If Salesforce is connected, accounts are synced in automatically.',
    });
  }

  steps.push(
    {
      id: 'dashboards',
      route: '/dashboard/dashboards',
      target: 'nav-dashboards',
      placement: 'right',
      title: 'Dashboards',
      body: 'An overview of your agreements by status, type and expiry date.',
    },
    {
      id: 'ask-ai',
      route: '/dashboard/ask-ai',
      target: 'nav-ask-ai',
      placement: 'right',
      title: 'Ask E',
      body: 'Ask questions about your contracts in plain language and get answers, summaries and charts. For example: which NDAs expire this quarter?',
    },
  );

  if (canWrite) {
    steps.push({
      id: 'templates',
      route: '/dashboard/templates',
      target: 'nav-templates',
      placement: 'right',
      title: 'Template build',
      body: 'Turn a Word document into a reusable template, with the fields and clauses that are filled in when an agreement is generated.',
    });
  }

  steps.push({
    id: 'done',
    title: 'That is all',
    body: 'You can run this tour again from the top bar whenever you need it.',
  });

  return steps;
}

/* --------------------------- positioning --------------------------- */

function placeCard(spot, preferred, size, viewport) {
  const { w, h } = size;
  const { vw, vh } = viewport;

  // Narrow screens: a bottom sheet is more usable than a floating card.
  if (vw < 640) return { left: (vw - w) / 2, top: Math.max(CARD_MARGIN, vh - h - CARD_MARGIN) };
  if (!spot) return { left: (vw - w) / 2, top: (vh - h) / 2 };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const candidates = {
    right: () => ({ left: spot.left + spot.width + CARD_GAP, top: spot.top + spot.height / 2 - h / 2 }),
    left: () => ({ left: spot.left - CARD_GAP - w, top: spot.top + spot.height / 2 - h / 2 }),
    bottom: () => ({ left: spot.left, top: spot.top + spot.height + CARD_GAP }),
    top: () => ({ left: spot.left, top: spot.top - CARD_GAP - h }),
  };
  const fits = ({ left, top }) =>
    left >= CARD_MARGIN && top >= CARD_MARGIN && left + w <= vw - CARD_MARGIN && top + h <= vh - CARD_MARGIN;

  const order = [preferred, 'right', 'bottom', 'left', 'top'].filter((p, i, all) => p && all.indexOf(p) === i);
  let chosen = null;
  for (const name of order) {
    const pos = candidates[name]();
    // For side placements only the cross axis may be clamped; for top/bottom only the horizontal one.
    const clamped = {
      left: name === 'right' || name === 'left' ? pos.left : clamp(pos.left, CARD_MARGIN, vw - CARD_MARGIN - w),
      top: name === 'top' || name === 'bottom' ? pos.top : clamp(pos.top, CARD_MARGIN, vh - CARD_MARGIN - h),
    };
    if (fits(clamped)) {
      chosen = clamped;
      break;
    }
  }
  if (!chosen) {
    chosen = {
      left: clamp(spot.left, CARD_MARGIN, vw - CARD_MARGIN - w),
      top: clamp(spot.top + spot.height + CARD_GAP, CARD_MARGIN, vh - CARD_MARGIN - h),
    };
  }
  return chosen;
}

/* ----------------------------- component ----------------------------- */

function GuidedTour({ open, onClose }) {
  const { canWrite } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const steps = useMemo(() => buildSteps({ canWrite }), [canWrite]);

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });
  const [viewport, setViewport] = useState({ vw: window.innerWidth, vh: window.innerHeight });
  const cardRef = useRef(null);

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  const finish = () => {
    markTourSeen();
    onClose();
  };

  // Always start from the beginning.
  useEffect(() => {
    if (open) {
      setIndex(0);
      setRect(null);
    }
  }, [open]);

  // Go to the page this step is about.
  useEffect(() => {
    if (open && step.route && location.pathname !== step.route) navigate(step.route);
  }, [open, step, location.pathname, navigate]);

  // Follow the target element every frame, so the spotlight survives page
  // animations, scrolling and layout shifts. If it never shows up, fall back
  // to a centered card.
  useEffect(() => {
    if (!open) return undefined;
    if (!step.target) {
      setRect(null);
      return undefined;
    }
    let frame;
    let scrolled = false;
    const startedAt = performance.now();

    const tick = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        if (!scrolled) {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          scrolled = true;
        }
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
      } else if (performance.now() - startedAt > TARGET_WAIT_MS) {
        setRect(null);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, step]);

  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (isLast) finish();
        else setIndex((i) => i + 1);
      } else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // finish is recreated each render but only closes over onClose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLast, onClose]);

  // Measure the card so it can be placed without overflowing the screen.
  useLayoutEffect(() => {
    if (!open || !cardRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = cardRef.current;
    setCardSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [open, index, rect]);

  if (!open) return null;

  const spot = step.target && rect
    ? {
        top: rect.top - SPOT_PAD,
        left: rect.left - SPOT_PAD,
        width: rect.width + SPOT_PAD * 2,
        height: rect.height + SPOT_PAD * 2,
      }
    : null;
  const position = placeCard(spot, step.placement, cardSize, viewport);
  const progress = ((index + 1) / steps.length) * 100;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      {spot ? (
        <div
          className="tour__spot"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      ) : (
        <div className="tour__dim" />
      )}

      <div ref={cardRef} className="tour__card" style={{ left: position.left, top: position.top }}>
        <div className="tour__progress">
          <div className="tour__progress-bar" style={{ width: `${progress}%` }} />
        </div>

        <div className="tour__body" key={step.id}>
          <div className="tour__counter">
            {index + 1} of {steps.length}
          </div>
          <h3 className="tour__title">{step.title}</h3>
          <p className="tour__text">{step.body}</p>
        </div>

        <div className="tour__footer">
          <button type="button" className="tour__skip" onClick={finish}>
            {isLast ? '' : 'Skip tour'}
          </button>

          <div className="tour__actions">
            {index > 0 && (
              <button type="button" className="tour__btn tour__btn--secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            <button
              type="button"
              className="tour__btn tour__btn--primary"
              onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
              autoFocus
            >
              {isLast ? 'Done' : index === 0 ? 'Start' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GuidedTour;
