import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
const dist = 'dist';
const htmlFiles = await Array.fromAsync(glob(`${dist}/**/*.html`, { absolute: true }));
// fs.glob 在 Windows 上返回反斜杠路径,统一成正斜杠,便于下方与 'dist/sitemap-0.xml' 比较。
const sitemapFiles = (await Array.fromAsync(glob(`${dist}/sitemap*.xml`))).map((file) =>
	file.replaceAll('\\', '/'),
);
const sitemapMatches = [];
for (const file of sitemapFiles) {
	const xml = await readFile(file, 'utf8');
	sitemapMatches.push(
		...[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) =>
			new URL(match[1], 'https://xh.asxz.one/'),
		),
	);
}

if (sitemapFiles.length === 0) throw new Error('No sitemap files found');
if (sitemapMatches.length === 0) throw new Error('Sitemap files contain no URLs');

const existingPaths = new Set();
for await (const path of glob(`${dist}/**/*`, { absolute: true })) {
	const relative = path.replaceAll('\\', '/');
	if (relative.startsWith('dist/')) existingPaths.add(relative.slice('dist/'.length));
}

const localUrlToPath = (pathname) => {
	if (pathname.endsWith('/')) return `${pathname.slice(1)}index.html`;
	if (/\.html$/.test(pathname)) return pathname.slice(1);
	return pathname.slice(1);
};

let checkedAssets = 0;
let checkedRoutes = 0;

for (const file of htmlFiles) {
	const html = await readFile(file, 'utf8');
	const references = [
		...html.matchAll(/<(?:script|link|img|source|use)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g),
	].map((match) => match[1]);

	for (const reference of references) {
		const url = new URL(reference, 'https://xh.asxz.one/');
		if (url.origin !== 'https://xh.asxz.one') continue;
		const localPath = localUrlToPath(url.pathname);
		if (!existingPaths.has(localPath)) {
			throw new Error(`Missing local reference ${url.pathname} in ${file}`);
		}
		if (url.search || url.hash) checkedRoutes++;
		else checkedAssets++;
	}

	const astroModules = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/g)];
	if (astroModules.length === 0) throw new Error(`No Astro module script in ${file}`);

	for (const module of astroModules) {
		const url = new URL(module[1], 'https://xh.asxz.one/');
		if (!existingPaths.has(localUrlToPath(url.pathname))) {
			throw new Error(`Missing Astro module ${url.pathname} in ${file}`);
		}
		checkedAssets++;
	}
}

for (const sitemap of sitemapMatches) {
	if (!existingPaths.has(localUrlToPath(sitemap.pathname))) {
		throw new Error(`Sitemap route does not exist: ${sitemap.pathname}`);
	}
	checkedRoutes++;
}

if (!sitemapFiles.includes('dist/sitemap-0.xml')) throw new Error('sitemap-0.xml is missing');

const preloadCount = (
	await Promise.all(
		htmlFiles.map(async (file) =>
			(await readFile(file, 'utf8')).match(
				/<link\b[^>]*\brel=["'](?:preload|modulepreload)["']/g,
			)?.length ?? 0,
		),
	)
).reduce((sum, count) => sum + count, 0);

console.log(
	`Verified ${htmlFiles.length} HTML files, ${checkedAssets} assets, ${checkedRoutes} routes, and ${preloadCount} preload links.`,
);
