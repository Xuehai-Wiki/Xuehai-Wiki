import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
import { blackMask, encrypt, hashPassword } from './utils/xh-crypto.mjs';

/* ---------- 文档加密(身份校验)元数据 ---------- */

/** 注入到 entry.data.xhLock 的锁信息,页面脚本与锁横幅据此工作。 */
export interface XhLockMeta {
	/** partial:正文 %%…%% 片段加密;full:标题/简介/正文全部涂黑。 */
	mode: 'partial' | 'full';
	/** 口令校验哈希(FNV-1a ×2,16 位十六进制),用于免明文比对。 */
	hash: string;
	/** full 模式:标题密文(Base64)与标题码点数(用于恢复 <title> 前缀)。 */
	t?: string;
	tl?: number;
	/** full 模式:description / excerpt 密文(Base64)。 */
	d?: string;
	e?: string;
}

/**
 * 文档 frontmatter 在 zod 校验后的形状(z.output 推导,保留 Starlight 全部字段),
 * transform 输出在它基础上剥除 password/protect、注入 xhLock。
 */
const docsBaseSchema = docsSchema({
	extend: z.object({
		// 维基分类:每篇文档可挂一个或多个分类,分类名即分组标签。
		categories: z.array(z.string()).optional(),
		// 文章简介一句话,用于文档首页索引与卡片预览。
		excerpt: z.string().optional(),
		// ---------- 身份校验(纯前端遮蔽)----------
		// 文档密码:设置后进入"部分涂黑"模式,正文 %%…%% 段落被加密。
		password: z.string().min(1).optional(),
		// protect: full 进入"完全涂黑"模式:标题/简介/摘要/正文全部 █。
		protect: z.enum(['full']).optional(),
	}),
});
type DocsDataIn = z.output<ReturnType<typeof docsBaseSchema>>;
type DocsDataOut = Omit<DocsDataIn, 'password' | 'protect'> & { xhLock?: XhLockMeta };

/**
 * 构建期 frontmatter 加密:对声明了 password 的文档
 *   - partial:保留原 frontmatter,注入 xhLock(模式 + 口令哈希);
 *   - full:标题/简介/摘要/分类就地涂黑,强制隐藏 TOC、退出搜索索引、
 *     侧栏与上下篇标签改用涂黑标题,并把标题/简介/摘要密文放进 xhLock。
 * password/protect 随后从 entry.data 剥除;正文加密由 rehype-xh-lock 插件
 * 直接读源文件完成,两侧只共享口令,不共享明文数据。
 */
function applyXhLock(data: DocsDataIn): DocsDataOut {
	const { password, protect } = data;
	// 剥除明文口令字段(entry.data 不携带密码)。
	const base: DocsDataOut = { ...data, password: undefined, protect: undefined } as DocsDataOut;
	delete (base as Record<string, unknown>).password;
	delete (base as Record<string, unknown>).protect;
	if (!password) return base;

	/** @type {XhLockMeta} */
	const meta: XhLockMeta = { mode: protect === 'full' ? 'full' : 'partial', hash: hashPassword(password) };

	if (meta.mode === 'full') {
		const title = typeof data.title === 'string' ? data.title : '';
		const desc = typeof data.description === 'string' ? data.description : '';
		const excerpt = typeof data.excerpt === 'string' ? data.excerpt : '';
		if (title) {
			base.title = blackMask(title);
			meta.t = encrypt(title, password);
			meta.tl = [...title].length;
			// 侧栏与上下篇的标签取 sidebar.label(优先于 title),一并涂黑。
			base.sidebar = { ...(data.sidebar ?? {}), label: blackMask(title) };
		}
		if (desc) {
			base.description = blackMask(desc);
			meta.d = encrypt(desc, password);
		}
		if (excerpt) {
			base.excerpt = blackMask(excerpt);
			meta.e = encrypt(excerpt, password);
		}
		// 分类标签可能泄漏文章归属,涂黑;完全解锁后不恢复(见帮助文档说明)。
		if (Array.isArray(data.categories) && data.categories.length) {
			base.categories = data.categories.map((c) => blackMask(String(c)));
		}
		// 完全涂黑页:隐藏 TOC、退出搜索索引,防止锚点/目录泄漏标题结构。
		base.tableOfContents = false;
		base.pagefind = false;
	}

	return { ...base, xhLock: meta };
}

/** 文档集合:src/content/docs/*.md,由 Starlight 渲染,仅服务 /docs/*。
 *  entry id 加 'docs/' 前缀,使 Starlight 的根路径 [...slug] 只命中 /docs/...。
 *  自定义 generateId 会绕过 Starlight 默认的 index 剥离逻辑,这里手动去掉尾部
 *  '/index'(目录的 index.md → 目录 slug 本身),否则其 slug 是 'xxx/index',
 *  侧边栏无法用 'xxx' 引用,URL 也会带上 /index。
 */
const docs = defineCollection({
	loader: docsLoader({
		generateId: ({ entry }) =>
			'docs/' +
			entry
				.split('.')
				.slice(0, -1)
				.join('.')
				.replace(/\/index$/, ''),
	}),
	// Starlight schema + 项目扩展字段 + 构建期加密 transform(zod 管道,
	// 解析后的 entry.data 即涂黑/注入 xhLock 之后的数据)。
	schema: (ctx) => docsBaseSchema(ctx).transform(applyXhLock),
});

/** 学海特性(bug)追踪集合:src/content/tracker/XHPE-XXXX.md,编号从 1001 起。
 *  frontmatter 字段对应计划中的 Type/Status/APP Name/APP Version/XHCS/Title/Reporter,
 *  多行 Desc 写在正文里。
 */
const tracker = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/tracker' }),
	schema: z.object({
		// Type:Feature/Bug,视其有用还是有害
		type: z.enum(['Feature', 'Bug']),
		// Status:MIGHT/PARTLY VALID/VALID/CHANGED/FIXED
		status: z.enum(['MIGHT', 'PARTLY VALID', 'VALID', 'CHANGED', 'FIXED']),
		appName: z.string(),
		appVersion: z.string(),
		// 学海草台班子评分,1-5 整数
		xhcs: z.number().int().min(1).max(5),
		title: z.string(),
		// 提交者;留空时前端渲染为灰色"匿名"
		reporter: z.string().optional(),
	}),
});

/** Starlight UI 字符串覆盖:src/content/i18n/*.json(文件名即语言标签)。
 *  站点未配置 locales 时语言为默认 'en',此处将目录标题等改为中文。 */
const i18n = defineCollection({
	loader: glob({ pattern: '**/*.json', base: './src/content/i18n' }),
	schema: i18nSchema(),
});

export const collections = { docs, tracker, i18n };
