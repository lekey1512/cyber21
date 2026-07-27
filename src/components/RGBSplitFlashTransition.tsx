import { Children, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * RGBSplitFlashTransition — a premium "display recalibration" moment that
 * plays between two adjacent sections as their boundary crosses the centre of
 * the viewport.
 *
 * The effect is driven purely by natural scroll position (no pinning, no
 * snapping, no scroll locking). As the boundary between the two sections
 * approaches the centre of the viewport, a subtle red/cyan channel split
 * grows, the image dims slightly, and a brief white calibration flash fires
 * once at the exact peak. As the user keeps scrolling, everything merges back
 * to a perfectly stable image.
 *
 * Performance:
 *   - The overlay is a handful of empty <div>s, always mounted but invisible
 *     when idle (no React re-renders during the effect — all work goes through
 *     refs).
 *   - An IntersectionObserver gates a single requestAnimationFrame loop so it
 *     only runs while the boundary is near the viewport.
 *   - The loop reads one getBoundingClientRect per frame and writes only
 *     GPU-friendly properties (transform / translate3d / opacity / will-change).
 *     No layout writes, no filters, no canvas, no duplicated content trees.
 *
 * Usage:
 *   <RGBSplitFlashTransition>
 *     <Tokenomics />
 *     <CyberpsychoMeter />
 *   </RGBSplitFlashTransition>
 */

export interface RGBSplitFlashTransitionProps {
  /** The two sections to sit between. The boundary is measured between them. */
  children: ReactNode;
  /** Maximum red/cyan channel separation in px on desktop. */
  maxSeparationDesktop?: number;
  /** Maximum red/cyan channel separation in px on mobile. */
  maxSeparationMobile?: number;
  /** Half-height of the active zone as a fraction of viewport height. The
   *  effect ramps in over this distance either side of the viewport centre. */
  activeHalfWindow?: number;
  /** Peak opacity of each colour channel layer (0..1). */
  channelPeakOpacity?: number;
  /** White calibration flash duration in ms. */
  flashDurationMs?: number;
  /** Peak white flash opacity (0..1). */
  flashOpacity?: number;
  /** Overall brightness reduction at peak (0..1). */
  brightnessReduction?: number;
  /** One-shot horizontal nudge at peak, in px. */
  nudgePx?: number;
  /** Progress (0..1) above which the flash + nudge fire once per pass. */
  peakThreshold?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t: number) => t * t * (3 - 2 * t);

export default function RGBSplitFlashTransition({
  children,
  maxSeparationDesktop = 4,
  maxSeparationMobile = 2,
  activeHalfWindow = 0.3,
  channelPeakOpacity = 0.16,
  flashDurationMs = 80,
  flashOpacity = 0.07,
  brightnessReduction = 0.08,
  nudgePx = 1.5,
  peakThreshold = 0.9,
}: RGBSplitFlashTransitionProps) {
  const boundaryRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const redRef = useRef<HTMLDivElement | null>(null);
  const cyanRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);

  const flashFiredRef = useRef(false);
  const flashRafRef = useRef<number | null>(null);

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (!boundary) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const mobileMq = window.matchMedia('(max-width: 768px)');
    const resolveSep = () => (mobileMq.matches ? maxSeparationMobile : maxSeparationDesktop);

    let running = false;
    let wasActive = false;
    let raf = 0;

    const reset = () => {
      if (redRef.current) { redRef.current.style.transform = ''; redRef.current.style.opacity = '0'; }
      if (cyanRef.current) { cyanRef.current.style.transform = ''; cyanRef.current.style.opacity = '0'; }
      if (dimRef.current) { dimRef.current.style.opacity = '0'; dimRef.current.style.transform = ''; }
      if (flashRef.current) flashRef.current.style.opacity = '0';
      if (screenRef.current) screenRef.current.style.transform = '';
      if (flashRafRef.current) { cancelAnimationFrame(flashRafRef.current); flashRafRef.current = null; }
      flashFiredRef.current = false;
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const vh = window.innerHeight;
      const rect = boundary.getBoundingClientRect();
      const dist = Math.abs(rect.top - vh / 2);
      const half = vh * activeHalfWindow;

      if (dist >= half) {
        if (wasActive) { reset(); wasActive = false; }
        return;
      }
      wasActive = true;

      const raw = 1 - dist / half;
      const p = smoothstep(clamp01(raw));
      const sep = p * resolveSep();

      if (redRef.current) {
        redRef.current.style.transform = `translate3d(${-sep}px,0,0)`;
        redRef.current.style.opacity = String(p * channelPeakOpacity);
      }
      if (cyanRef.current) {
        cyanRef.current.style.transform = `translate3d(${sep}px,0,0)`;
        cyanRef.current.style.opacity = String(p * channelPeakOpacity);
      }
      if (dimRef.current) {
        dimRef.current.style.opacity = String(p * brightnessReduction);
      }

      // One-shot calibration flash + nudge at the exact peak.
      if (p >= peakThreshold && !flashFiredRef.current) {
        flashFiredRef.current = true;
        const start = performance.now();
        if (screenRef.current) screenRef.current.style.transform = `translate3d(${nudgePx}px,0,0)`;
        if (dimRef.current) dimRef.current.style.transform = `translate3d(${nudgePx}px,0,0)`;
        const flashEl = flashRef.current;
        const animateFlash = (now: number) => {
          const t = (now - start) / flashDurationMs;
          if (t >= 1) {
            if (flashEl) flashEl.style.opacity = '0';
            if (screenRef.current) screenRef.current.style.transform = '';
            if (dimRef.current) dimRef.current.style.transform = '';
            flashRafRef.current = null;
            return;
          }
          // Triangle pulse: 0 → flashOpacity → 0 over the window.
          if (flashEl) flashEl.style.opacity = String(flashOpacity * (1 - Math.abs(2 * t - 1)));
          flashRafRef.current = requestAnimationFrame(animateFlash);
        };
        flashRafRef.current = requestAnimationFrame(animateFlash);
      }

      // Allow the flash to re-trigger on the next pass once the user scrolls
      // back away from the peak.
      if (p < peakThreshold - 0.15 && flashFiredRef.current) {
        flashFiredRef.current = false;
        if (flashRafRef.current) { cancelAnimationFrame(flashRafRef.current); flashRafRef.current = null; }
        if (flashRef.current) flashRef.current.style.opacity = '0';
        if (screenRef.current) screenRef.current.style.transform = '';
        if (dimRef.current) dimRef.current.style.transform = '';
      }
    };

    const run = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const halt = () => {
      running = false;
      cancelAnimationFrame(raf);
      reset();
      wasActive = false;
    };

    // Active whenever the boundary is near the viewport — the rAF itself gates
    // the visible effect to a narrow band around the viewport centre.
    const margin = Math.round((activeHalfWindow + 0.1) * 100);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? run : halt)();
      },
      { rootMargin: `${margin}% 0px ${margin}% 0px` },
    );
    obs.observe(boundary);

    return () => {
      obs.disconnect();
      cancelAnimationFrame(raf);
      if (flashRafRef.current) cancelAnimationFrame(flashRafRef.current);
    };
  }, [
    activeHalfWindow,
    maxSeparationDesktop,
    maxSeparationMobile,
    channelPeakOpacity,
    flashDurationMs,
    flashOpacity,
    brightnessReduction,
    nudgePx,
    peakThreshold,
  ]);

  const [first, second] = Children.toArray(children);

  const channelStyle = (color: string): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    background: color,
    opacity: 0,
    willChange: 'transform, opacity',
  });

  return (
    <>
      {first}
      {/* Zero-height boundary marker — the scroll-progress reference. */}
      <div ref={boundaryRef} aria-hidden style={{ height: 0 }} />
      {second}

      {/* Additive colour channels + flash. Screen-blended with the page so the
          base image stays intact and only light is added at the fringes. */}
      <div
        ref={screenRef}
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 9999,
          mixBlendMode: 'screen',
          willChange: 'transform',
        }}
      >
        <div ref={redRef} style={channelStyle('#FF003C')} />
        <div ref={cyanRef} style={channelStyle('#00F0FF')} />
        <div
          ref={flashRef}
          style={{
            position: 'absolute',
            inset: 0,
            background: '#fff',
            opacity: 0,
            willChange: 'opacity',
          }}
        />
      </div>

      {/* Brightness reduction layer — normal blend, sits just below the colour
          channels so it darkens the image at the peak. */}
      <div
        ref={dimRef}
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 9998,
          background: '#000',
          opacity: 0,
          willChange: 'opacity, transform',
        }}
      />
    </>
  );
}
