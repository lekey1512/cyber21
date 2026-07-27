import {
  useEffect,
  useId,
  useRef,
  Children,
  type ReactNode,
} from 'react';

/**
 * SectionDistortionTransition
 * ---------------------------
 * A reusable scroll-bound "analog signal interference" transition between two
 * adjacent sections. As the boundary between the two sections crosses the
 * viewport center, a short cinematic distortion burst plays across BOTH
 * sections simultaneously, then everything locks back to a perfectly stable
 * picture.
 *
 * Pipeline (all layers combined, scroll-driven, no WebGL / no video):
 *   1. Horizontal wave displacement  — SVG feTurbulence + feDisplacementMap
 *   2. Subtle RGB channel split      — feColorMatrix + feOffset + feBlend
 *   3. Animated scanlines            — CSS repeating-linear-gradient overlay
 *   4. TV film-grain noise           — SVG turbulence background, scrolled
 *   5. Signal-loss crossfade dim     — both sections dip in opacity at peak
 *
 * The effect is scroll-bound (not time-bound): an `IntersectionObserver` arms a
 * single rAF loop only while the boundary is near the viewport. Every frame the
 * loop maps the boundary's position to a 0..1 progress `t`, folds it through a
 * sin(πt) envelope so distortion ramps in and out smoothly, and writes the
 * resulting values directly to DOM/SVG attributes — no React re-renders, no
 * per-frame allocations. When the boundary leaves the zone the loop stops and
 * all primitives are reset to neutral (filter: none, scale 0, opacity 1).
 */

export interface SectionDistortionTransitionProps {
  /** Exactly two sections, in order. Extra children render after the pair. */
  children: ReactNode;
  /** Peak horizontal wave displacement in px (default 8). */
  maxDisplacement?: number;
  /** Peak RGB channel separation in px (default 4). */
  maxRgbSplit?: number;
  /** Height of the transition zone as a fraction of viewport height (default 0.7). */
  zoneFactor?: number;
  /** Peak noise overlay opacity (default 0.12). */
  noiseOpacity?: number;
  /** Peak scanline opacity (default 0.18). */
  scanlineOpacity?: number;
  /** How much both sections dim at the peak of the burst, 0..1 (default 0.12). */
  sectionDim?: number;
  /** feTurbulence baseFrequency "fx fy" — lower = smoother waves (default "0.012 0.02"). */
  baseFrequency?: string;
  /** Extra className on the outer wrapper. */
  className?: string;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function SectionDistortionTransition({
  children,
  maxDisplacement = 8,
  maxRgbSplit = 4,
  zoneFactor = 0.7,
  noiseOpacity = 0.12,
  scanlineOpacity = 0.18,
  sectionDim = 0.12,
  baseFrequency = '0.012 0.02',
  className = '',
}: SectionDistortionTransitionProps) {
  const rawId = useId().replace(/[:]/g, '');
  const fid = `sdt-${rawId}`;

  const wrapRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const noiseRef = useRef<HTMLDivElement>(null);

  const kids = Children.toArray(children);
  const first = kids[0] ?? null;
  const second = kids[1] ?? null;
  const rest = kids.slice(2);

  useEffect(() => {
    const wrap = wrapRef.current;
    const sentinel = sentinelRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    const scan = scanRef.current;
    const noise = noiseRef.current;
    if (!wrap || !sentinel || !top || !bottom || !scan || !noise) return;

    const svg = wrap.querySelector('svg');
    const turb = svg?.querySelector(`#${fid}-turb`) as SVGFETurbulenceElement | null;
    const toff = svg?.querySelector(`#${fid}-toff`) as SVGFEOffsetElement | null;
    const disp = svg?.querySelector(`#${fid}-disp`) as SVGFEDisplacementMapElement | null;
    const roff = svg?.querySelector(`#${fid}-roff`) as SVGFEOffsetElement | null;
    const coff = svg?.querySelector(`#${fid}-coff`) as SVGFEOffsetElement | null;

    let raf = 0;
    let running = false;
    let active = false;
    let lastNow = performance.now();
    let timeAcc = 0;

    const writeAttr = (el: Element | null, name: string, v: number) => {
      if (el) el.setAttribute(name, v.toFixed(2));
    };

    // Reset every primitive to a perfectly neutral picture.
    const reset = () => {
      active = false;
      top.style.filter = 'none';
      bottom.style.filter = 'none';
      writeAttr(disp, 'scale', 0);
      writeAttr(roff, 'dx', 0);
      writeAttr(coff, 'dx', 0);
      writeAttr(toff, 'dx', 0);
      writeAttr(toff, 'dy', 0);
      scan.style.opacity = '0';
      noise.style.opacity = '0';
      top.style.opacity = '1';
      bottom.style.opacity = '1';
    };

    // Apply the current frame. `t` is linear 0..1 across the zone; `intensity`
    // is sin(πt) so distortion peaks at the center and is zero at the edges.
    const apply = (t: number, intensity: number) => {
      const on = intensity > 0.003;
      if (on !== active) {
        active = on;
        const f = on ? `url(#${fid})` : 'none';
        top.style.filter = f;
        bottom.style.filter = f;
      }

      if (on) {
        writeAttr(disp, 'scale', intensity * maxDisplacement);
        writeAttr(roff, 'dx', -intensity * maxRgbSplit);
        writeAttr(coff, 'dx', intensity * maxRgbSplit);
        // Scroll the turbulence pattern so the waves drift like live interference.
        writeAttr(toff, 'dx', Math.sin(timeAcc * 0.03) * 6 * intensity);
        writeAttr(toff, 'dy', Math.cos(timeAcc * 0.027) * 4 * intensity);
        scan.style.opacity = (intensity * scanlineOpacity).toFixed(3);
        noise.style.opacity = (intensity * noiseOpacity).toFixed(3);
        noise.style.backgroundPosition =
          `${((timeAcc * 0.4) % 180).toFixed(1)}px ${((timeAcc * 0.55) % 180).toFixed(1)}px`;
      } else if (active) {
        // Just switched off — clear the expensive primitives.
        writeAttr(disp, 'scale', 0);
        writeAttr(roff, 'dx', 0);
        writeAttr(coff, 'dx', 0);
        writeAttr(toff, 'dx', 0);
        writeAttr(toff, 'dy', 0);
        scan.style.opacity = '0';
        noise.style.opacity = '0';
      }

      // Both sections dim together at the peak — the "signal weakens" beat.
      const op = 1 - intensity * sectionDim;
      top.style.opacity = op.toFixed(3);
      bottom.style.opacity = op.toFixed(3);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - lastNow;
      lastNow = now;
      timeAcc += dt;

      const rect = sentinel.getBoundingClientRect();
      const vh = window.innerHeight;
      const zone = vh * zoneFactor;
      const center = vh * 0.5;
      // t = 0 when the boundary is zone/2 below center, 1 when zone/2 above.
      const t = clamp01((center + zone / 2 - rect.top) / zone);
      const intensity = Math.sin(t * Math.PI);
      apply(t, intensity);
    };

    // Arm the rAF loop only while the boundary is near the viewport. The wide
    // rootMargin means we start a touch before the boundary enters and stop
    // shortly after it leaves, then reset to a clean picture.
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e.isIntersecting) {
          if (!running) {
            running = true;
            lastNow = performance.now();
            raf = requestAnimationFrame(loop);
          }
        } else if (running) {
          running = false;
          cancelAnimationFrame(raf);
          reset();
        }
      },
      { rootMargin: '100% 0px 100% 0px' },
    );
    io.observe(sentinel);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fid, maxDisplacement, maxRgbSplit, zoneFactor, noiseOpacity, scanlineOpacity, sectionDim]);

  return (
    <div ref={wrapRef} className={`sdt-wrap ${className}`}>
      {/* Inline SVG filter — never rendered, only referenced by url(#fid). */}
      <svg className="sdt-svg" aria-hidden focusable="false" width="0" height="0">
        <defs>
          <filter
            id={fid}
            x="-15%"
            y="-15%"
            width="130%"
            height="130%"
            colorInterpolationFilters="sRGB"
            primitiveUnits="userSpaceOnUse"
          >
            {/* Layer 1 — smooth analog wave displacement */}
            <feTurbulence
              id={`${fid}-turb`}
              type="fractalNoise"
              baseFrequency={baseFrequency}
              numOctaves={2}
              seed={4}
              result="turb"
            />
            {/* Drift the noise so the waves live; cheap offset, no turbulence re-render. */}
            <feOffset id={`${fid}-toff`} in="turb" dx={0} dy={0} result="turbOff" />
            <feDisplacementMap
              id={`${fid}-disp`}
              in="SourceGraphic"
              in2="turbOff"
              scale={0}
              xChannelSelector="R"
              yChannelSelector="G"
              result="disp"
            />
            {/* Layer 2 — subtle red / cyan channel split on the displaced image */}
            <feColorMatrix
              in="disp"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="rOnly"
            />
            <feColorMatrix
              in="disp"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="cOnly"
            />
            <feOffset id={`${fid}-roff`} in="rOnly" dx={0} dy={0} result="rOff" />
            <feOffset id={`${fid}-coff`} in="cOnly" dx={0} dy={0} result="cOff" />
            <feBlend in="rOff" in2="cOff" mode="screen" result="split" />
            <feBlend in="split" in2="disp" mode="screen" />
          </filter>
        </defs>
      </svg>

      {/* The two sections, each a filter root so both distort together. */}
      <div ref={topRef} className="sdt-section" style={{ willChange: 'filter, opacity' }}>
        {first}
      </div>
      <div ref={sentinelRef} className="sdt-sentinel" aria-hidden />
      <div ref={bottomRef} className="sdt-section" style={{ willChange: 'filter, opacity' }}>
        {second}
      </div>
      {rest}

      {/* Layers 3 & 4 — fixed full-viewport interference overlay. */}
      <div ref={overlayRef} className="sdt-overlay">
        <div ref={scanRef} className="sdt-scanlines" style={{ opacity: 0 }} />
        <div ref={noiseRef} className="sdt-noise" style={{ opacity: 0 }} />
      </div>
    </div>
  );
}
