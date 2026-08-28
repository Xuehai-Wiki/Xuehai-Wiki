import { payload } from '@/payload/config';
import { getNavigation } from './navigation/auto';
import { getUrlMap } from './navigation/urlMap';
import { getAllDocPaths, getContentRegistry } from './content/registry';
import type { NavigationItem, GlobalConfig, ThemeConfig } from './payload/types';
import type { UrlMap } from './navigation/url';

/**
 * The resolved site model.
 *
 * Pages and layouts read from here rather than from `payload/config.ts`
 * directly, because navigation and URLs are only fully determined once the
 * content directory has been scanned. Server-only.
 */
export interface Site {
  /** Global configuration, verbatim from the payload */
  global: GlobalConfig;
  /** Theme overrides, if any */
  theme?: Partial<ThemeConfig>;
  /** Navigation tree, with discovered documents merged in */
  navigation: NavigationItem[];
  /** Bidirectional mapping between content paths and URL segments */
  urlMap: UrlMap;
  /** Every buildable document path, including ones hidden from navigation */
  docPaths: string[];
  /** Paths that should be built but never listed or indexed */
  hiddenPaths: Set<string>;
}

/**
 * Collects every path that must stay unlisted.
 *
 * A page can be marked hidden in two independent places — `hidden: true` in its
 * frontmatter, or on its entry in the curated navigation — and consulting only
 * one of them is how a page ends up hidden from the sidebar yet still announced
 * in the sitemap and in search. Hiding a section hides everything beneath it.
 *
 * @param navigation - Resolved navigation tree
 * @returns Content paths to exclude from listings
 */
export function collectHiddenPaths(navigation: NavigationItem[]): Set<string> {
  const hidden = new Set<string>();

  for (const doc of getContentRegistry().docs) {
    if (doc.hidden) hidden.add(doc.path);
  }

  function visit(items: NavigationItem[], inherited: boolean) {
    for (const item of items) {
      const isHidden = inherited || item.hidden === true;
      if (isHidden && item.path) hidden.add(item.path);
      if (item.children) visit(item.children, isHidden);
    }
  }

  visit(navigation, false);
  return hidden;
}

/**
 * Resolves the site model from the payload and the content directory.
 *
 * Each underlying piece memoises its own work, so calling this per page is
 * cheap.
 *
 * @returns The resolved site
 *
 * @example
 * ```typescript
 * const site = getSite();
 * site.navigation; // curated entries plus discovered documents
 * site.urlMap.strategy; // 'path' | 'hash'
 * ```
 */
export function getSite(): Site {
  const navigation = getNavigation(payload.navigation, payload.global.autoNavigation ?? true);

  return {
    global: payload.global,
    theme: payload.theme,
    navigation,
    urlMap: getUrlMap(),
    docPaths: getAllDocPaths(),
    hiddenPaths: collectHiddenPaths(navigation),
  };
}
