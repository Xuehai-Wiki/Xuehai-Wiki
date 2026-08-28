'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Shows where a wiki link goes before a reader commits to following it.
 *
 * The title and summary are already on the anchor as `data-preview-*`,
 * written there during the build, so the card costs no request and appears
 * immediately. A single delegated listener covers every link on the page,
 * including any that arrive with a transcluded block.
 *
 * Rendered into `document.body` rather than in place. The card is positioned
 * against the viewport, and `position: fixed` resolves against the nearest
 * transformed ancestor instead — which the page-transition wrapper is, so a
 * card rendered here landed roughly a screenful off the top of the window.
 *
 * @example
 * ```tsx
 * <article dangerouslySetInnerHTML={{ __html: html }} />
 * <LinkPreview />
 * ```
 */

/** Milliseconds a pointer must rest on a link before the card appears. */
const OPEN_DELAY_MS = 350;

/** Milliseconds before a card closes, so a pointer may cross a gap. */
const CLOSE_DELAY_MS = 120;

/** Distance from the link to the card. */
const OFFSET_PX = 8;

/** Card width, needed here to keep it on screen. */
const WIDTH_PX = 320;

interface PreviewState {
  title: string;
  excerpt: string;
  top: number;
  left: number;
  /** Whether the card sits below its link rather than above */
  below: boolean;
}

export function LinkPreview() {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearTimers() {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    }

    function place(anchor: HTMLElement): PreviewState | null {
      const title = anchor.getAttribute('data-preview-title');
      if (!title) return null;

      const rect = anchor.getBoundingClientRect();

      // Above the link by default, below it when there is no room above —
      // a card that opens off the top of the viewport shows nothing.
      const below = rect.top < 160;

      return {
        title,
        excerpt: anchor.getAttribute('data-preview') ?? '',
        top: below ? rect.bottom + OFFSET_PX : rect.top - OFFSET_PX,
        left: Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - WIDTH_PX - 8)),
        below,
      };
    }

    function open(anchor: HTMLElement, delay: number) {
      clearTimers();
      openTimer.current = setTimeout(() => {
        const next = place(anchor);
        if (next) setPreview(next);
      }, delay);
    }

    function close(delay = CLOSE_DELAY_MS) {
      clearTimers();
      closeTimer.current = setTimeout(() => setPreview(null), delay);
    }

    function anchorFrom(target: EventTarget | null): HTMLElement | null {
      return (target as HTMLElement | null)?.closest?.<HTMLElement>('a.ezw-wikilink') ?? null;
    }

    function handleOver(event: MouseEvent) {
      const anchor = anchorFrom(event.target);
      if (anchor) open(anchor, OPEN_DELAY_MS);
    }

    function handleOut(event: MouseEvent) {
      if (anchorFrom(event.target)) close();
    }

    // Keyboard users reach the link by tabbing, and get the same card without
    // the delay a pointer needs to signal intent.
    function handleFocus(event: FocusEvent) {
      const anchor = anchorFrom(event.target);
      if (anchor) open(anchor, 0);
    }

    function handleBlur(event: FocusEvent) {
      if (anchorFrom(event.target)) close(0);
    }

    // Dismissible without moving the pointer, which WCAG asks of anything that
    // appears on hover.
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close(0);
    }

    document.addEventListener('mouseover', handleOver);
    document.addEventListener('mouseout', handleOut);
    document.addEventListener('focusin', handleFocus);
    document.addEventListener('focusout', handleBlur);
    // Any movement of the page leaves the card pointing at nothing. Named so
    // that the cleanup below can actually remove it.
    function handleScroll() {
      close(0);
    }

    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      clearTimers();
      document.removeEventListener('mouseover', handleOver);
      document.removeEventListener('mouseout', handleOut);
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('focusout', handleBlur);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  if (!preview || typeof document === 'undefined') return null;

  return createPortal(
    <div
      // Presentational: the link it describes is already in the accessible
      // tree, and announcing the summary twice would be noise.
      aria-hidden="true"
      className="ezw-link-preview"
      style={{
        top: preview.top,
        left: preview.left,
        width: WIDTH_PX,
        transform: preview.below ? undefined : 'translateY(-100%)',
      }}
    >
      <p className="ezw-link-preview__title">{preview.title}</p>
      {preview.excerpt && <p className="ezw-link-preview__excerpt">{preview.excerpt}</p>}
    </div>,
    document.body,
  );
}
