import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * ShuffleText — cyberpunk terminal "resolving" animation.
 *
 * Renders the given text as a sequence of glyph cells. On first scroll into
 * view (via IntersectionObserver), each cell cycles through random glyphs
 * for a staggered duration before locking to its final character. After the
 * one-shot run it stays completely static. Hovering the heading replays the
 * shuffle from the top.
 *
 * Layout is preserved: each glyph is a fixed-width inline-block sized to the
 * rendered character, so the heading occupies the same space before, during,
 * and after the animation. Only transform/opacity are animated, so it stays
 * GPU-composited and never triggers layout or paint.
 *
 * Integrates with the existing reveal system: the root carries the supplied
 * className (e.g. `reveal-glitch`) so scroll-reveal still applies, and the
 * shuffle only starts once that reveal has fired.
 */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*<>/\\|=+-';

interface Props {
  text: string;
  className?: string;
  /** Per-glyph shuffle duration in ms. */
  duration?: number;
  /** Max stagger between glyphs in ms. */
  stagger?: number;
  as?: 'h1' | 'h2' | 'h3';
}

interface Cell {
  final: string;
  display: string;
  locked: boolean;
}

const isSpace = (c: string) => c === ' ';

export default function ShuffleText({
  text,
  className = '',
  duration = 700,
  stagger = 35,
  as: Tag = 'h2',
}: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const startedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const [cells, setCells] = useState<Cell[]>(
    () => Array.from(text, (c) => ({ final: c, display: c, locked: true })),
  );

  const run = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    // Reset to shuffling state for non-space glyphs.
    setCells(
      Array.from(text, (c) =>
        isSpace(c)
          ? { final: c, display: c, locked: true }
          : { final: c, display: GLYPHS[(Math.random() * GLYPHS.length) | 0], locked: false },
      ),
    );

    const start = performance.now();
    const lockTimes = Array.from(
      { length: text.length },
      (_, i) => start + duration + i * stagger,
    );

    const tick = () => {
      const now = performance.now();
      let allLocked = true;
      setCells((prev) =>
        prev.map((cell, i) => {
          if (cell.locked || isSpace(cell.final)) return cell;
          if (now >= lockTimes[i]) {
            return { ...cell, display: cell.final, locked: true };
          }
          allLocked = false;
          return { ...cell, display: GLYPHS[(Math.random() * GLYPHS.length) | 0] };
        }),
      );
      if (!allLocked) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [text, duration, stagger]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !startedRef.current) {
            startedRef.current = true;
            // Defer slightly so the reveal-glitch entrance doesn't fight it.
            const t = window.setTimeout(run, 120);
            timersRef.current.push(t);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(root);

    const onEnter = () => run();
    root.addEventListener('mouseenter', onEnter);

    return () => {
      obs.disconnect();
      root.removeEventListener('mouseenter', onEnter);
      timersRef.current.forEach((t) => clearTimeout(t));
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [run]);

  return (
    <Tag
      ref={rootRef as React.RefObject<HTMLHeadingElement>}
      className={className}
      style={{ display: 'inline-flex', flexWrap: 'wrap' }}
    >
      {cells.map((cell, i) =>
        isSpace(cell.final) ? (
          <span key={i} style={{ width: '0.3em' }} />
        ) : (
          <span
            key={i}
            style={{
              display: 'inline-block',
              whiteSpace: 'pre',
              willChange: 'contents',
            }}
          >
            {cell.display}
          </span>
        ),
      )}
    </Tag>
  );
}
