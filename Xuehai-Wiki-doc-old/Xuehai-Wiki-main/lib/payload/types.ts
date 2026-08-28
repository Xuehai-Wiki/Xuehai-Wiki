import type { UrlStrategy } from '../navigation/url';

/**
 * Navigation item in the sidebar hierarchy
 */
export interface NavigationItem {
  /** Display name of the navigation item */
  name: string;
  /** Optional path to content file (without .md extension) */
  path?: string;
  /** Optional nested navigation items */
  children?: NavigationItem[];
  /** Optional icon identifier */
  icon?: string;
  /** Optional background color for the navigation item */
  color?: string;
  /** Hide this item from navigation (accessible only via direct URL) */
  hidden?: boolean;
}

/**
 * Global site configuration
 */
export interface GlobalConfig {
  /** Site title displayed in browser tab */
  title: string;
  /** Site description for SEO */
  description: string;
  /** Path to favicon */
  favicon?: string;
  /**
   * BCP 47 language tag for the content, e.g. `ko`, `ja`, `en-GB`.
   *
   * Announced on the root element. Screen readers pick pronunciation from it
   * and translation tools decide what to offer, so a Korean wiki left at the
   * `en` default is read aloud as English. Defaults to `en`.
   */
  lang?: string;
  /** Base URL for the site */
  baseUrl?: string;
  /**
   * Source repository for this site.
   *
   * Shown as a link in the sidebar when set, and omitted entirely when not, so
   * a private or unpublished wiki does not advertise one.
   */
  repoUrl?: string;
  /**
   * How content paths are expressed in URLs.
   *
   * `path` produces readable, indexable URLs mirroring the content tree.
   * `hash` produces opaque hashes that conceal the structure at the cost of
   * SEO and shareability. Defaults to `path`.
   */
  urlStrategy?: UrlStrategy;
  /**
   * Discover documents under `content/` and add any that navigation does not
   * already reference. Enabled by default, so a new Markdown file appears in
   * the sidebar without touching this config.
   */
  autoNavigation?: boolean;
  /** SEO metadata */
  seo?: {
    openGraph?: {
      title?: string;
      description?: string;
      images?: Array<{
        url: string;
        width?: number;
        height?: number;
        alt?: string;
      }>;
    };
    twitter?: {
      card?: 'summary' | 'summary_large_image' | 'app' | 'player';
      site?: string;
      creator?: string;
      title?: string;
      description?: string;
      images?: string[];
    };
  };
}

/**
 * Theme color configuration
 */
export interface ThemeConfig {
  /** Primary brand color */
  primary: string;
  /** Secondary accent color */
  secondary: string;
  /** Background color */
  background: string;
  /** Text color */
  text: string;
  /** Sidebar background color */
  sidebarBg: string;
  /** Code block background */
  codeBg: string;
}

/**
 * Complete payload structure
 */
export interface Payload {
  /** Global site configuration */
  global: GlobalConfig;
  /**
   * Curated navigation structure.
   *
   * Optional: when omitted, navigation is derived entirely from the content
   * directory. When present, these entries control naming and ordering, and
   * undeclared documents are appended automatically unless
   * {@link GlobalConfig.autoNavigation} is disabled.
   */
  navigation?: NavigationItem[];
  /** Theme customization */
  theme?: Partial<ThemeConfig>;
}
