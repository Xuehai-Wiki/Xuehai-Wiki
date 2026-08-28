import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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

// 注:原本的 docs 集合(Starlight 文档)已移除——/docs 现由仓库内的旧 Next.js
// 维基应用(wiki-app/)整体提供,见 README.md 的「双应用构建」说明。
export const collections = { tracker };