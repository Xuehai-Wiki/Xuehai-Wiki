import { MetadataRoute } from 'next';
import { getSite } from '@/lib/site';
import { docPathToUrl } from '@/lib/navigation/url';
import { pageUrl } from '@/lib/basePath';
import { getTags } from '@/lib/content/tags';

/**
 * Generates the sitemap for every published page.
 *
 * Entries are derived from the content registry rather than from navigation,
 * so documents reachable only by direct link are still discoverable. Pages
 * marked `hidden` are excluded — they are deliberately unlisted, and
 * advertising them in the sitemap would defeat that.
 *
 * Under the `hash` URL strategy the emitted URLs are hashes, which search
 * engines can crawl but which carry no descriptive value; the `path` strategy
 * is the one to use if organic search matters.
 *
 * @returns Sitemap entries for the home page and all visible content
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const { global, urlMap, docPaths, hiddenPaths } = getSite();
  const lastModified = new Date();

  const homeEntry: MetadataRoute.Sitemap[0] = {
    url: pageUrl('', global.baseUrl),
    lastModified,
    changeFrequency: 'weekly',
    priority: 1,
  };

  const contentEntries = docPaths.flatMap((path): MetadataRoute.Sitemap => {
    if (hiddenPaths.has(path)) return [];

    const url = docPathToUrl(urlMap, path);
    if (!url) return [];

    return [
      {
        url: pageUrl(url, global.baseUrl),
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.8,
      },
    ];
  });

  // Tag pages are indexable and canonical, so leaving them out of the sitemap
  // said one thing to a crawler following links and another to one reading
  // this. The index is listed even when empty; a tag page only exists when
  // something carries it.
  const tagEntries: MetadataRoute.Sitemap = [
    {
      url: pageUrl('tags', global.baseUrl),
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.4,
    },
    ...getTags().map((tag) => ({
      url: pageUrl(`tags/${tag.slug}`, global.baseUrl),
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.4,
    })),
  ];

  return [homeEntry, ...contentEntries, ...tagEntries];
}
