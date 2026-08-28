import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * Loads the module with a given deployment environment.
 *
 * The base path and origin are read once at import time — they cannot change
 * during a build — so exercising a different deployment means re-importing
 * rather than reassigning.
 *
 * @param env - Values for the two deployment variables
 * @returns The freshly imported module
 */
async function load(env: { basePath?: string; siteUrl?: string }) {
  vi.resetModules();
  process.env.NEXT_PUBLIC_BASE_PATH = env.basePath ?? '';
  process.env.NEXT_PUBLIC_SITE_URL = env.siteUrl ?? '';
  return import('./basePath');
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe('asset', () => {
  it('leaves public paths alone when served from the root', async () => {
    const { asset } = await load({});
    expect(asset('/favicon.svg')).toBe('/favicon.svg');
  });

  it('prefixes public paths with the base path', async () => {
    const { asset } = await load({ basePath: '/eziwiki' });
    expect(asset('/favicon.svg')).toBe('/eziwiki/favicon.svg');
    expect(asset('/fonts/SUITE/SUITE-Regular.woff2')).toBe(
      '/eziwiki/fonts/SUITE/SUITE-Regular.woff2',
    );
  });

  it('leaves absolute and protocol-relative URLs untouched', async () => {
    const { asset } = await load({ basePath: '/eziwiki' });
    expect(asset('https://cdn.example.com/logo.svg')).toBe('https://cdn.example.com/logo.svg');
    expect(asset('//cdn.example.com/logo.svg')).toBe('//cdn.example.com/logo.svg');
  });
});

describe('pageUrl', () => {
  it('composes origin, base path and a trailing slash', async () => {
    const { pageUrl } = await load({ basePath: '/eziwiki', siteUrl: 'https://user.github.io' });
    expect(pageUrl('getting-started/quick-start')).toBe(
      'https://user.github.io/eziwiki/getting-started/quick-start/',
    );
  });

  it('returns the home page for an empty segment', async () => {
    const { pageUrl } = await load({ basePath: '/eziwiki', siteUrl: 'https://user.github.io' });
    expect(pageUrl('')).toBe('https://user.github.io/eziwiki/');
  });

  it('falls back to the payload base URL when the deployment declares none', async () => {
    const { pageUrl } = await load({});
    expect(pageUrl('intro', 'https://example.com')).toBe('https://example.com/intro/');
  });

  it('lets the deployment origin override the payload base URL', async () => {
    const { pageUrl } = await load({ siteUrl: 'https://user.github.io' });
    expect(pageUrl('intro', 'https://placeholder.dev')).toBe('https://user.github.io/intro/');
  });

  it('does not double up slashes however the parts are written', async () => {
    const { pageUrl } = await load({ siteUrl: 'https://user.github.io/' });
    expect(pageUrl('/intro/', 'https://placeholder.dev/')).toBe('https://user.github.io/intro/');
  });

  // The sitemap advertises these URLs and the canonical tag names them; if the
  // two disagree on the slash, the sitemap points at a redirect.
  it('agrees with the trailing-slash form Next serves', async () => {
    const { pageUrl } = await load({ basePath: '/eziwiki', siteUrl: 'https://user.github.io' });
    expect(pageUrl('intro')).toMatch(/\/$/);
  });

  // A mirror is served from a subdirectory of its own host while the canonical
  // site is elsewhere. Combining the two would name a path that exists on
  // neither: 'https://production.app/eziwiki/intro/'.
  it('omits the base path when canonicalising to another deployment', async () => {
    const { pageUrl } = await load({ basePath: '/eziwiki' });
    expect(pageUrl('intro', 'https://production.app')).toBe('https://production.app/intro/');
  });

  it('includes the base path when the deployment is itself canonical', async () => {
    const { pageUrl } = await load({ basePath: '/eziwiki', siteUrl: 'https://user.github.io' });
    expect(pageUrl('intro', 'https://production.app')).toBe(
      'https://user.github.io/eziwiki/intro/',
    );
  });
});

describe('fileUrl', () => {
  it('composes origin and base path without a trailing slash', async () => {
    const { fileUrl } = await load({ basePath: '/eziwiki', siteUrl: 'https://user.github.io' });
    expect(fileUrl('/sitemap.xml')).toBe('https://user.github.io/eziwiki/sitemap.xml');
    expect(fileUrl('/og-image.svg')).toBe('https://user.github.io/eziwiki/og-image.svg');
  });

  it('accepts a path written without a leading slash', async () => {
    const { fileUrl } = await load({ siteUrl: 'https://user.github.io' });
    expect(fileUrl('og-image.svg')).toBe('https://user.github.io/og-image.svg');
  });

  it('leaves an already absolute image alone', async () => {
    const { fileUrl } = await load({ basePath: '/eziwiki', siteUrl: 'https://user.github.io' });
    expect(fileUrl('https://cdn.example.com/og.png')).toBe('https://cdn.example.com/og.png');
  });

  it('omits the base path when canonicalising to another deployment', async () => {
    const { fileUrl } = await load({ basePath: '/eziwiki' });
    expect(fileUrl('/og-image.svg', 'https://production.app')).toBe(
      'https://production.app/og-image.svg',
    );
  });
});
