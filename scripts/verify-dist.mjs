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

/* ---------- 文档身份校验(涂黑加密)防泄漏检查 ----------
 * 重新解析源码 frontmatter,任何声明了 password 的文档:
 *   - 部分模式:%%……%% 中的明文段不得出现在任何构建产物 HTML 里;
 *   - 完全模式:标题/描述/摘要明文不得出现在任何构建产物 HTML 里
 *     (包括侧栏、反链、graph.json 之外的 HTML 文本)。
 * 标题等短词可能撞车别的正常文本,只在长度 ≥ 4 码点时才计入检查。
 */
const distHtmlTexts = [];
for (const file of htmlFiles) {
	distHtmlTexts.push([file, await readFile(file, 'utf8')]);
}
const xhLeaks = [];
let xhLockedDocs = 0;
{
	const { readdirSync } = await import('node:fs');
	const docsDir = 'src/content/docs';
	if (readdirSync(docsDir).includes('xh-lock.md')) {
		const { readFileSync } = await import('node:fs');
		const cryptoPath = new URL('../src/utils/xh-crypto.mjs', import.meta.url);
		const { parseScalarFrontmatter } = await import(cryptoPath.href);
		for (const name of readdirSync(docsDir)) {
			if (!name.endsWith('.md') || name.startsWith('_')) continue;
			const fm = parseScalarFrontmatter(readFileSync(`${docsDir}/${name}`, 'utf8'));
			if (!fm.password) continue;
			xhLockedDocs++;
			const full = fm.protect === 'full';
			/** @type {string[]} */
			const plains = [];
			if (full) {
				for (const key of ['title', 'description', 'excerpt']) {
					const v = (fm[key] || '').replace(/^['"]|['"]$/g, '').trim();
					if ([...v].length >= 4) plains.push(v);
				}
			} else {
				// 部分模式:抽取正文里的 %%……%% 明文段。
				const raw = readFileSync(`${docsDir}/${name}`, 'utf8');
				const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
				for (const m of body.matchAll(/%%([\s\S]+?)%%/g)) {
					if (m[1].trim().length >= 4) plains.push(m[1].trim());
				}
			}
			for (const plain of plains) {
				for (const [file, html] of distHtmlTexts) {
					if (html.includes(plain)) {
						xhLeaks.push(`${plain.slice(0, 30)} (${name}) -> ${file.replaceAll('\\', '/')}`);
					}
				}
			}
		}
	}
}
if (xhLeaks.length > 0) {
	throw new Error(`Protected doc plaintext leaked into dist (${xhLeaks.length}):\n` + xhLeaks.join('\n'));
}

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
	`Verified ${htmlFiles.length} HTML files, ${checkedAssets} assets, ${checkedRoutes} routes, ${preloadCount} preload links, and ${xhLockedDocs} encrypted docs (no plaintext leaks).`,
);
