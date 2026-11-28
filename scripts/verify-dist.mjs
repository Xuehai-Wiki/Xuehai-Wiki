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
/** 声明了 password(part) 却没有任何 %%……%% 片段的文档:横幅会显示但无内容可解。 */
const xhEmptyPartials = [];
let xhLockedDocs = 0;
{
	const { readdirSync, readFileSync } = await import('node:fs');
	const path = await import('node:path');
	const docsDir = 'src/content/docs';
	// 递归收集所有 .md(子目录如 deep-dive-into-ztp/、research/ 下的加密文档同样要检查),
	// 只跳过 '_' 开头的文件与目录(约定为草稿/片段)。
	const collectDocs = (dir) => {
		const out = [];
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) out.push(...collectDocs(full));
			else if (entry.name.endsWith('.md')) out.push(full);
		}
		return out;
	};
	if (readdirSync(docsDir).includes('xh-lock.md')) {
		const cryptoPath = new URL('../src/utils/xh-crypto.mjs', import.meta.url);
		const { parseScalarFrontmatter } = await import(cryptoPath.href);
		for (const docPath of collectDocs(docsDir)) {
			const name = docPath.replaceAll('\\', '/').replace('src/content/docs/', '');
			const raw = readFileSync(docPath, 'utf8');
			const fm = parseScalarFrontmatter(raw);
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
				const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
				const segs = [...body.matchAll(/%%([\s\S]+?)%%/g)];
				// 只设了 password 却没有任何 %%……%% 片段时,页面会渲染出解锁横幅,
				// 但解锁后内容毫无变化——视为配置错误,构建期直接拦下。
				if (segs.length === 0) {
					xhEmptyPartials.push(name);
				}
				for (const m of segs) {
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
if (xhEmptyPartials.length > 0) {
	throw new Error(
		`Partial-locked docs declare password but contain no %%...%% segment (unlock banner would show with nothing to reveal):\n` +
			xhEmptyPartials.join('\n'),
	);
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
