import { useEffect, useRef, Children } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * DirectionalParallaxTransition
 *
 * Wraps two adjacent sections and gives the hand-off between them a quiet,
 * cinematic sense of depth using only directional parallax. No glitches,
 * flashes, distortion, noise, scanlines, RGB split, blur, masks, clip-path,
 * canvas, shaders, or fullscreen overlays — only `translate3d` on transform.
 *
 * How it feels:
 *   - As the boundary nears the viewport center, the exiting section's
 *     layers lag behind the scroll (inertia / drifting away).
 *   - The incoming section's layers lead the scroll (rushing toward you),
 *     then ease back into place as it becomes the dominant layer.
 *   - Three depth tiers (background / decorative / content) move by
 *     different magnitudes, so the space reads as layered without the
 *     movement ever becoming consciously noticeable.
 *
 * Performance:
 *   - An IntersectionObserver on a zero-height sentinel at the boundary
 *     gates a single requestAnimationFrame loop. The loop only runs while
 *     the boundary is near the viewport and is killed the instant it leaves.
 *   - Per frame: one getBoundingClientRect (the sentinel) + N transform
 *     writes. No layout reads on the layers themselves, no reflows, no
 *     paint-heavy properties. All work is GPU-composited via translate3d.
 *
 * Reuse:
 *   <DirectionalParallaxTransition>
 *     <SectionA />
 *     <SectionB />
 *   </DirectionalParallaxTransition>
 *
 * Sections opt their layers in by tagging elements with:
 *   data-depth="background" | "decorative" | "content"
 * Untagged sections are left untouched.
 */

type Depth = 'background' | 'decorative' | 'content';

// Parallax magnitude per depth tier. Bigger = more deviation from natural
// scroll. Background is the most "distant" (lags/leads the most), content the
// most grounded (closest to natural scroll). Values are fractions of one
// viewport height, kept deliberately small so the effect stays sub-perceptual.
const FACTORS: Record<Depth, number> = {
  background: 0.03,
  decorative: 0.018,
  content: 0.008,
};

interface Layer {
  el: HTMLElement;
  factor: number;
  exiting: boolean;
}

interface Props {
  children: ReactNode;
  /** Half-height of the active zone as a fraction of viewport height. */
  zone?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function DirectionalParallaxTransition({ children, zone = 1 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const sentinel = sentinelRef.current;
    if (!wrap || !sentinel) return;

    // The two sections are the sentinel's siblings in the wrapper.
    const secA = sentinel.previousElementSibling as HTMLElement | null;
    const secB = sentinel.nextElementSibling as HTMLElement | null;
    if (!secA || !secB) return;

    const layers: Layer[] = Array.from(
      wrap.querySelectorAll<HTMLElement>('[data-depth]'),
    ).map((el) => {
      const d = (el.dataset.depth as Depth | undefined) ?? 'content';
      return {
        el,
        factor: FACTORS[d] ?? FACTORS.content,
        exiting: secA.contains(el),
      };
    });
    if (!layers.length) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let active = false;

    const update = () => {
      raf = requestAnimationFrame(update);
      const vh = window.innerHeight;
      // Boundary position in viewport coords (sentinel is zero-height).
      const boundaryY = sentinel.getBoundingClientRect().top;
      // 0 when boundary is at the bottom of the viewport, 1 at the top.
      const t = clamp01((vh - boundaryY) / vh);

      for (const l of layers) {
        // Exiting layers lag (pushed down → move up slower than scroll).
        // Incoming layers lead (pushed up → move up faster), then ease
        // back to natural as the section settles into place (t→1).
        const offset = l.exiting
          ? l.factor * t * vh
          : -l.factor * t * (1 - t) * 4 * vh;
        l.el.style.transform = `translate3d(0,${offset.toFixed(2)}px,0)`;
      }
    };

    const start = () => {
      if (active) return;
      active = true;
      for (const l of layers) l.el.style.willChange = 'transform';
      raf = requestAnimationFrame(update);
    };

    const stop = () => {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      for (const l of layers) {
        l.el.style.willChange = '';
        l.el.style.transform = '';
      }
    };

    // Activate slightly before the boundary enters the zone so the first
    // frame of motion is already correct (offsets are 0 at the zone edge,
    // so there is no visible jump on start or stop).
    const margin = `${zone * 100}% 0px ${zone * 100}% 0px`;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? start : stop)();
      },
      { rootMargin: margin },
    );
    obs.observe(sentinel);

    return () => {
      obs.disconnect();
      stop();
    };
  }, [zone]);

  const items = Children.toArray(children) as ReactElement[];

  return (
    <div ref={wrapRef}>
      {items[0]}
      <div ref={sentinelRef} aria-hidden style={{ height: 0 }} />
      {items[1]}
    </div>
  );
}
