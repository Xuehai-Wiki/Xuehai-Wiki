'use client';

import { useEffect } from 'react';

/**
 * Wires up copy-to-clipboard for build-time rendered code blocks.
 *
 * The buttons themselves are emitted during the build by `rehypeCodeShell`;
 * this component only attaches behaviour. A single delegated listener on the
 * document handles every block on the page, which is what lets the syntax
 * highlighting stack stay out of the client bundle entirely — previously the
 * whole Prism highlighter shipped just to render a copy button.
 *
 * @example
 * ```tsx
 * <article dangerouslySetInnerHTML={{ __html: html }} />
 * <CodeCopy />
 * ```
 */
export function CodeCopy() {
  useEffect(() => {
    /** Milliseconds the confirmation label stays visible. */
    const CONFIRM_MS = 2000;
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    async function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>('[data-ezw-copy]');
      if (!button) return;

      const code = button.closest('[data-ezw-code]')?.querySelector('pre');
      if (!code) return;

      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
      } catch {
        // Clipboard access is denied outside secure contexts; leave the label
        // unchanged so the failure is visible rather than falsely confirmed.
        return;
      }

      button.textContent = '✓ Copied';
      button.setAttribute('data-copied', '');

      clearTimeout(timers.get(button));
      timers.set(
        button,
        setTimeout(() => {
          button.textContent = 'Copy';
          button.removeAttribute('data-copied');
          timers.delete(button);
        }, CONFIRM_MS),
      );
    }

    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('click', handleClick);
      timers.forEach(clearTimeout);
    };
  }, []);

  return null;
}
