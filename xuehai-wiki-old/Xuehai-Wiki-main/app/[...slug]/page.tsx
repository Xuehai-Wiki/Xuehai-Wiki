import { MarkdownContent } from '@/components/markdown/MarkdownContent';
import { PageTransition } from '@/components/markdown/PageTransition';
import { TableOfContents } from '@/components/layout/TableOfContents';
import { Backlinks } from '@/components/layout/Backlinks';
import { LocalGraph } from '@/components/layout/LocalGraph';
import { PageNavigation } from '@/components/layout/PageNavigation';
import { PageTags } from '@/components/layout/PageTags';
import { MovedPage } from '@/components/layout/MovedPage';
import { getBacklinks, getLocalGraph } from '@/lib/graph/build';
import { getAdjacentPages } from '@/lib/navigation/sequence';
import { getAliasMap, aliasUrl, resolveAliasUrl } from '@/lib/content/aliases';
import { getTagsFor } from '@/lib/content/tags';
import { renderDoc } from '@/lib/markdown/render';
import { getDoc, type ContentDoc } from '@/lib/content/registry';
import { docPathToUrl, urlToDocPath } from '@/lib/navigation/url';
import { getSite } from '@/lib/site';
import { asset, fileUrl, pageUrl } from '@/lib/basePath';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

interface PageProps {
  params: {
    slug: string[];
  };
}

/**
 * Resolves a route's slug segments to a document in the content registry.
 *
 * Under the `path` strategy a slug has one segment per directory level; under
 * `hash` it is a single opaque segment. Joining first and resolving through the
 * URL map handles both without the route needing to know which is in effect.
 *
 * @param slug - Route segments captured by the catch-all route
 * @returns The content path and its canonical URL segment, or null
 */
function resolveSlug(slug: string[]): { path: string; url: string } | null {
  const { urlMap } = getSite();
  const url = slug.join('/');
  const path = urlToDocPath(urlMap, url);

  return path ? { path, url } : null;
}

/**
 * Resolves a slug that names a page's former address.
 *
 * Checked only after the live map misses, so a real page always wins over an
 * alias — an alias shadowing a page is refused when the index is built, but
 * order here makes the intent explicit.
 *
 * @param slug - Route segments captured by the catch-all route
 * @returns The document that superseded the address, and its URL, or null
 */
function resolveMoved(slug: string[]): { path: string; url: string } | null {
  const { urlMap } = getSite();
  const path = resolveAliasUrl(slug.join('/'), urlMap.strategy);
  if (!path) return null;

  const url = docPathToUrl(urlMap, path);
  return url ? { path, url } : null;
}

/**
 * Generates per-page metadata from the document's frontmatter.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { global, hiddenPaths } = getSite();
  const resolved = resolveSlug(params.slug);
  const doc = resolved ? getDoc(resolved.path) : undefined;

  if (!resolved || !doc) {
    const moved = resolveMoved(params.slug);
    const target = moved ? getDoc(moved.path) : undefined;

    // A former address should not compete with the page it forwards to: it is
    // kept out of the index, and points its canonical at the destination so any
    // ranking the old URL earned transfers rather than being split.
    if (moved && target) {
      return {
        title: target.title,
        description: target.description || global.description,
        alternates: { canonical: pageUrl(moved.url, global.baseUrl) },
        robots: { index: false, follow: true },
      };
    }

    return { title: global.title, description: global.description };
  }

  const title = doc.title;
  const description = doc.description || global.description;
  const rawOgImage = doc.frontmatter.ogImage as string | undefined;
  const ogImage = rawOgImage ? fileUrl(rawOgImage, global.baseUrl) : undefined;
  const canonicalUrl = pageUrl(resolved.url, global.baseUrl);

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    icons: {
      icon: asset((doc.frontmatter.favicon as string) || global.favicon || '/favicon.ico'),
    },
    // Hidden pages stay reachable by direct link but should not be indexed.
    robots: hiddenPaths.has(resolved.path) ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      images: ogImage ? [ogImage] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

/**
 * Enumerates every document for static generation.
 *
 * The list comes from the content registry, so a Markdown file is built whether
 * or not navigation references it. That is what lets hidden and unlisted pages
 * work without a parallel registration step.
 */
export async function generateStaticParams() {
  const { urlMap, docPaths } = getSite();

  const pages = docPaths.flatMap((path) => {
    const url = docPathToUrl(urlMap, path);
    return url ? [{ slug: url.split('/') }] : [];
  });

  // Former addresses are built too, each as a page that forwards. Without this
  // there is nothing at the old URL for a static host to serve.
  const moved = [...getAliasMap().keys()].map((alias) => ({
    slug: aliasUrl(alias, urlMap.strategy).split('/'),
  }));

  return [...pages, ...moved];
}

/**
 * Emits Article structured data for a document.
 */
function ArticleSchema({ doc, url }: { doc: ContentDoc; url: string }) {
  const { global } = getSite();
  const baseUrl = global.baseUrl || 'https://example.com';
  const published = doc.frontmatter.date ?? null;
  const modified = doc.frontmatter.updated ?? published;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: doc.title,
          description: doc.description || global.description,
          url: `${baseUrl}/${url}`,
          // Dates are omitted when absent rather than stamped with the build
          // time: a fabricated date misleads both readers and crawlers.
          ...(published ? { datePublished: published } : {}),
          ...(modified ? { dateModified: modified } : {}),
          author: {
            '@type': 'Organization',
            name: global.title,
          },
        }),
      }}
    />
  );
}

/**
 * Renders a content page: the document body, plus its table of contents on
 * screens wide enough to carry a second column.
 */
export default async function ContentPage({ params }: PageProps) {
  const resolved = resolveSlug(params.slug);

  if (!resolved) {
    const moved = resolveMoved(params.slug);
    const target = moved ? getDoc(moved.path) : undefined;

    if (moved && target) return <MovedPage url={`/${moved.url}/`} title={target.title} />;

    notFound();
  }

  const doc = getDoc(resolved.path);
  const rendered = await renderDoc(resolved.path);

  if (!doc || !rendered) notFound();

  return (
    <PageTransition>
      <div className="flex gap-8">
        <article className="prose prose-slate min-w-0 max-w-none flex-1 dark:prose-invert">
          <ArticleSchema doc={doc} url={resolved.url} />
          <PageTags tags={getTagsFor(resolved.path)} />
          <MarkdownContent html={rendered.html} />
          <PageNavigation adjacent={getAdjacentPages(resolved.path)} />
          <Backlinks links={getBacklinks(resolved.path)} />
          <LocalGraph graph={getLocalGraph(resolved.path)} path={resolved.path} />
        </article>

        <aside className="hidden w-56 flex-shrink-0 xl:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
            <TableOfContents headings={rendered.headings} />
          </div>
        </aside>
      </div>
    </PageTransition>
  );
}
