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
 * viewport center, a short cinematic distortion burst plays across a thin strip
 * centered on the boundary, then everything locks back to a stable picture.
 *
 * Performance strategy (vs. the full-section filter approach):
 *  - The SVG distortion filter is applied ONLY to a thin (~220px) transparent
 *    strip straddling the section boundary, via `backdrop-filter: url(#fid)`.
 *    The strip distorts whatever is painted behind it — i.e. pixels of BOTH
 *    sections within the strip — so the overlap still distorts together, but
 *    the expensive filtered paint area is ~5% of a full section instead of 200%.
 *  - No `getBoundingClientRect()` inside the rAF loop. The boundary's document
 *    offset is cached once and refreshed only on resize / ResizeObserver
 *    (layout changes). Each frame reads only `window.scrollY` (no forced layout).
 *  - Noise background drift is a pure CSS keyframe animation; JS only sets opacity.
 *  - SVG attribute writes are diffed — a value is written only when it changes
 *    by more than a small epsilon, so steady-state frames do zero SVG writes.
 *  - The rAF loop computes intensity and pushes it to the filter primitives and
 *    overlay opacities; scanline drift, noise drift, and the dim veil are CSS.
 */

export interface SectionDistortionTransitionProps {
  /** Exactly two sections, in order. Extra children render after the pair. */
  children: ReactNode;
  /** Peak horizontal wave displacement in px (default 8). */
  maxDisplacement?: number;
  /** Peak RGB channel separation in px (default 4). */
  maxRgbSplit?: number;
  /** Height of the scroll zone as a fraction of viewport height (default 0.7). */
  zoneFactor?: number;
  /** Height of the distorted strip in px (default 220). */
  stripHeight?: number;
  /** Peak noise overlay opacity (default 0.12). */
  noiseOpacity?: number;
  /** Peak scanline opacity (default 0.18). */
  scanlineOpacity?: number;
  /** Peak dim-veil opacity, 0..1 (default 0.12). */
  dimOpacity?: number;
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
  stripHeight = 220,
  noiseOpacity = 0.12,
  scanlineOpacity = 0.18,
  dimOpacity = 0.12,
  baseFrequency = '0.012 0.02',
  className = '',
}: SectionDistortionTransitionProps) {
  const rawId = useId().replace(/[:]/g, '');
  const fid = `sdt-${rawId}`;

  const wrapRef = useRef<HTMLDivElement>(null);
  const boundaryRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const noiseRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);

  const kids = Children.toArray(children);
  const first = kids[0] ?? null;
  const second = kids[1] ?? null;
  const rest = kids.slice(2);

  useEffect(() => {
    const wrap = wrapRef.current;
    const boundary = boundaryRef.current;
    const strip = stripRef.current;
    const scan = scanRef.current;
    const noise = noiseRef.current;
    const dim = dimRef.current;
    if (!wrap || !boundary || !strip || !scan || !noise || !dim) return;

    const svg = strip.querySelector('svg');
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
    let boundaryDocTop = 0; // cached document offset of the section boundary

    // Last-written values — a primitive is only written when it actually changes.
    const prev = {
      disp: -999,
      roff: -999,
      coff: -999,
      toffX: -999,
      toffY: -999,
      scan: -999,
      noise: -999,
      dim: -999,
    };
    const EPS = 0.04;

    const setAttr = (el: Element | null, name: string, v: number) => {
      if (el) el.setAttribute(name, v.toFixed(2));
    };

    // Recompute the boundary's document offset. Called outside the rAF loop
    // (mount, resize, ResizeObserver) so the hot path never forces layout.
    const cacheLayout = () => {
      const r = boundary.getBoundingClientRect();
      boundaryDocTop = r.top + window.scrollY;
    };

    // Reset every primitive to a perfectly neutral picture.
    const reset = () => {
      active = false;
      strip.style.backdropFilter = 'none';
      strip.style.webkitBackdropFilter = 'none';
      setAttr(disp, 'scale', 0);
      setAttr(roff, 'dx', 0);
      setAttr(coff, 'dx', 0);
      setAttr(toff, 'dx', 0);
      setAttr(toff, 'dy', 0);
      scan.style.opacity = '0';
      noise.style.opacity = '0';
      dim.style.opacity = '0';
      prev.disp = prev.roff = prev.coff = prev.toffX = prev.toffY = 0;
      prev.scan = prev.noise = prev.dim = 0;
    };

    const maybe = (key: keyof typeof prev, v: number, fn: () => void) => {
      if (Math.abs(v - prev[key]) > EPS) {
        prev[key] = v;
        fn();
      }
    };

    // `t` is linear 0..1 across the zone; `intensity` = sin(πt) peaks at center.
    const apply = (intensity: number) => {
      const on = intensity > 0.003;
      if (on !== active) {
        active = on;
        const f = on ? `url(#${fid})` : 'none';
        strip.style.backdropFilter = f;
        strip.style.webkitBackdropFilter = f;
        if (!on) {
          setAttr(disp, 'scale', 0);
          setAttr(roff, 'dx', 0);
          setAttr(coff, 'dx', 0);
          setAttr(toff, 'dx', 0);
          setAttr(toff, 'dy', 0);
          prev.disp = prev.roff = prev.coff = prev.toffX = prev.toffY = 0;
        }
      }

      if (on) {
        maybe('disp', intensity * maxDisplacement, () =>
          setAttr(disp, 'scale', intensity * maxDisplacement),
        );
        maybe('roff', -intensity * maxRgbSplit, () =>
          setAttr(roff, 'dx', -intensity * maxRgbSplit),
        );
        maybe('coff', intensity * maxRgbSplit, () =>
          setAttr(coff, 'dx', intensity * maxRgbSplit),
        );
        // Drift the turbulence pattern so the displacement waves live.
        const tx = Math.sin(timeAcc * 0.03) * 6 * intensity;
        const ty = Math.cos(timeAcc * 0.027) * 4 * intensity;
        maybe('toffX', tx, () => setAttr(toff, 'dx', tx));
        maybe('toffY', ty, () => setAttr(toff, 'dy', ty));

        const sOp = intensity * scanlineOpacity;
        const nOp = intensity * noiseOpacity;
        const dOp = intensity * dimOpacity;
        maybe('scan', sOp, () => (scan.style.opacity = sOp.toFixed(3)));
        maybe('noise', nOp, () => (noise.style.opacity = nOp.toFixed(3)));
        maybe('dim', dOp, () => (dim.style.opacity = dOp.toFixed(3)));
      } else if (active) {
        scan.style.opacity = '0';
        noise.style.opacity = '0';
        dim.style.opacity = '0';
        prev.scan = prev.noise = prev.dim = 0;
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - lastNow;
      lastNow = now;
      timeAcc += dt;

      // No getBoundingClientRect here — just scrollY (a cached number, no layout).
      const boundaryTop = boundaryDocTop - window.scrollY;
      const vh = window.innerHeight;
      const zone = vh * zoneFactor;
      const center = vh * 0.5;
      const t = clamp01((center + zone / 2 - boundaryTop) / zone);
      const intensity = Math.sin(t * Math.PI);
      apply(intensity);
    };

    cacheLayout();

    // Refresh the cached boundary offset whenever layout could have shifted.
    const ro = new ResizeObserver(cacheLayout);
    ro.observe(wrap);
    ro.observe(boundary);
    window.addEventListener('resize', cacheLayout, { passive: true });

    // Arm the rAF loop only while the boundary is near the viewport.
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
    io.observe(boundary);

    return () => {
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('resize', cacheLayout);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fid, maxDisplacement, maxRgbSplit, zoneFactor, stripHeight, noiseOpacity, scanlineOpacity, dimOpacity]);

  return (
    <div ref={wrapRef} className={`sdt-wrap ${className}`}>
      {/* Section A — rendered untouched, no filter applied. */}
      {first}

      {/* Zero-height boundary marker. The distorted strip is centered on it. */}
      <div ref={boundaryRef} className="sdt-boundary" aria-hidden>
        <div
          ref={stripRef}
          className="sdt-strip"
          style={{ height: `${stripHeight}px` }}
        >
          {/* Inline SVG filter — never painted, only referenced by backdrop-filter. */}
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
                {/* Layer 2 — subtle red / cyan channel split */}
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
        </div>
      </div>

      {/* Section B — rendered untouched, no filter applied. */}
      {second}
      {rest}

      {/* Layers 3, 4 & dim veil — fixed full-viewport interference overlay. */}
      <div className="sdt-overlay">
        <div ref={dimRef} className="sdt-dim" style={{ opacity: 0 }} />
        <div ref={scanRef} className="sdt-scanlines" style={{ opacity: 0 }} />
        <div ref={noiseRef} className="sdt-noise" style={{ opacity: 0 }} />
      </div>
    </div>
  );
}
