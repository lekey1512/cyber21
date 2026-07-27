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
 * adjacent sections. As the boundary crosses the viewport center, a short
 * cinematic distortion burst plays, then everything locks back to a stable
 * picture.
 *
 * Rendering engine: pure GPU-friendly CSS compositing. No SVG filters, no
 * backdrop-filter, no runtime SVG attribute writes. The only job of JS is to
 * compute a single normalized intensity (0..1) from scroll position and push
 * it to a handful of CSS variables on one element. Every visual layer is driven
 * by CSS (transitions, animations, calc on those variables).
 *
 * Layers (all composited with mix-blend-mode, transform & opacity — the cheap
 * GPU properties — so nothing triggers layout or heavy paint):
 *   1. Scanlines       — repeating-linear-gradient, CSS-animated drift.
 *   2. Film grain       — tiled SVG-noise data-URI texture, CSS keyframe drift.
 *   3. RGB split        — two translated overlay layers (red / cyan) blended over
 *                         a shared snapshot-free stack; separation scales with
 *                         intensity.
 *   4. Glitch slices    — horizontal bands via clip-path, each with its own
 *                         CSS-animated translateX jitter.
 *   5. Brightness dip   — a black veil whose opacity tracks intensity.
 *   6. Fade in/out       — the whole overlay's opacity follows sin(πt).
 *
 * The boundary's document offset is cached once and refreshed only on resize /
 * ResizeObserver; the rAF loop reads only `window.scrollY` (no forced layout).
 * An IntersectionObserver arms the loop only while the boundary is near the
 * viewport, then stops and resets when it leaves.
 */

export interface SectionDistortionTransitionProps {
  /** Exactly two sections, in order. Extra children render after the pair. */
  children: ReactNode;
  /** Height of the scroll zone as a fraction of viewport height (default 0.7). */
  zoneFactor?: number;
  /** Peak RGB channel separation in px (default 4). */
  maxRgbSplit?: number;
  /** Peak glitch-slice horizontal shift in px (default 10). */
  maxSliceShift?: number;
  /** Peak brightness-dip opacity, 0..1 (default 0.14). */
  dimOpacity?: number;
  /** Peak scanline opacity (default 0.18). */
  scanlineOpacity?: number;
  /** Peak film-grain opacity (default 0.12). */
  grainOpacity?: number;
  /** Extra className on the outer wrapper. */
  className?: string;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function SectionDistortionTransition({
  children,
  zoneFactor = 0.7,
  maxRgbSplit = 4,
  maxSliceShift = 10,
  dimOpacity = 0.14,
  scanlineOpacity = 0.18,
  grainOpacity = 0.12,
  className = '',
}: SectionDistortionTransitionProps) {
  const rawId = useId().replace(/[:]/g, '');
  const uid = `sdt-${rawId}`;

  const wrapRef = useRef<HTMLDivElement>(null);
  const boundaryRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const kids = Children.toArray(children);
  const first = kids[0] ?? null;
  const second = kids[1] ?? null;
  const rest = kids.slice(2);

  // Six glitch slice bands. Each gets a unique clip-path window and its own
  // CSS-animated translateX keyframes (defined inline via a <style> tag so the
  // keyframe names are unique to this instance and don't collide).
  const slices = [
    { top: 8, height: 6, delay: 0.0, amp: 1.0 },
    { top: 22, height: 4, delay: -0.4, amp: 0.7 },
    { top: 34, height: 9, delay: -0.2, amp: 1.2 },
    { top: 50, height: 5, delay: -0.6, amp: 0.8 },
    { top: 63, height: 7, delay: -0.1, amp: 1.0 },
    { top: 78, height: 5, delay: -0.5, amp: 0.6 },
  ];

  useEffect(() => {
    const wrap = wrapRef.current;
    const boundary = boundaryRef.current;
    const host = hostRef.current;
    if (!wrap || !boundary || !host) return;

    let raf = 0;
    let running = false;
    let boundaryDocTop = 0;
    let lastIntensity = -1;
    const EPS = 0.004;

    // Recompute the boundary's document offset. Called outside the rAF loop
    // (mount, resize, ResizeObserver) so the hot path never forces layout.
    const cacheLayout = () => {
      const r = boundary.getBoundingClientRect();
      boundaryDocTop = r.top + window.scrollY;
    };

    // Push the single intensity value to CSS variables on the host. All visual
    // layers read these via calc(); no other JS-driven style writes happen.
    const apply = (intensity: number) => {
      if (Math.abs(intensity - lastIntensity) < EPS) return;
      lastIntensity = intensity;
      const iStr = intensity.toFixed(4);
      host.style.setProperty('--sdt-i', iStr);
      host.style.setProperty('--sdt-rgb', (intensity * maxRgbSplit).toFixed(2));
      host.style.setProperty('--sdt-slice', (intensity * maxSliceShift).toFixed(2));
      host.style.setProperty('--sdt-dim', (intensity * dimOpacity).toFixed(4));
      host.style.setProperty('--sdt-scan', (intensity * scanlineOpacity).toFixed(4));
      host.style.setProperty('--sdt-grain', (intensity * grainOpacity).toFixed(4));
    };

    const reset = () => {
      lastIntensity = -1;
      apply(0);
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      // No getBoundingClientRect here — just scrollY (cached, no forced layout).
      const boundaryTop = boundaryDocTop - window.scrollY;
      const vh = window.innerHeight;
      const zone = vh * zoneFactor;
      const center = vh * 0.5;
      const t = clamp01((center + zone / 2 - boundaryTop) / zone);
      const intensity = Math.sin(t * Math.PI);
      apply(intensity);
    };

    cacheLayout();

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
  }, [zoneFactor, maxRgbSplit, maxSliceShift, dimOpacity, scanlineOpacity, grainOpacity]);

  // Per-instance keyframes for the glitch slices. Names are namespaced with the
  // instance id so multiple transitions on one page never collide.
  const sliceKeyframes = slices
    .map((s, idx) => {
      const name = `${uid}-slice-${idx}`;
      const amp = s.amp;
      return `@keyframes ${name} {
  0%, 100% { transform: translateX(calc(var(--sdt-slice, 0px) * ${amp} * 0)); }
  20% { transform: translateX(calc(var(--sdt-slice, 0px) * ${amp} * 0.8)); }
  45% { transform: translateX(calc(var(--sdt-slice, 0px) * ${amp} * -1)); }
  70% { transform: translateX(calc(var(--sdt-slice, 0px) * ${amp} * 0.5)); }
  90% { transform: translateX(calc(var(--sdt-slice, 0px) * ${amp} * -0.3)); }
}`;
    })
    .join('\n');

  return (
    <div ref={wrapRef} className={`sdt-wrap ${className}`}>
      {/* Section A — rendered untouched. */}
      {first}

      {/* Zero-height boundary marker. The interference overlay is centered on it. */}
      <div ref={boundaryRef} className="sdt-boundary" aria-hidden>
        <div ref={hostRef} className="sdt-host" style={{ ['--sdt-i' as string]: 0 }}>
          {/* Per-instance slice keyframes. */}
          <style dangerouslySetInnerHTML={{ __html: sliceKeyframes }} />

          {/* Layer 5 — brightness dip (black veil). */}
          <div className="sdt-dim" />

          {/* Layer 4 — horizontal glitch slices. Each band is a clip-path window
              over a copy of the overlay content, translated by its own keyframes. */}
          <div className="sdt-slices">
            {slices.map((s, idx) => (
              <div
                key={idx}
                className="sdt-slice"
                style={{
                  clipPath: `inset(${s.top}% 0 ${100 - s.top - s.height}% 0)`,
                  animation: `${uid}-slice-${idx} 0.5s steps(2, end) infinite`,
                  animationDelay: `${s.delay}s`,
                }}
              >
                {/* The slice shows a shifted red/cyan tinted band to read as a
                    horizontal signal tear. */}
                <div className="sdt-slice-fill" />
              </div>
            ))}
          </div>

          {/* Layer 3 — RGB split. Two translated overlay layers (red / cyan)
              blended over the picture. Separation scales with --sdt-rgb. */}
          <div className="sdt-rgb sdt-rgb-r" />
          <div className="sdt-rgb sdt-rgb-c" />

          {/* Layer 1 — scanlines. */}
          <div className="sdt-scanlines" />

          {/* Layer 2 — film grain. */}
          <div className="sdt-grain" />
        </div>
      </div>

      {/* Section B — rendered untouched. */}
      {second}
      {rest}
    </div>
  );
}
