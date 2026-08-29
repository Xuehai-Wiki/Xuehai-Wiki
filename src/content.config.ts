import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

/** 文档集合:src/content/docs/*.md,由 Starlight 渲染,仅服务 /docs/*。
 *  entry id 加 'docs/' 前缀,使 Starlight 的根路径 [...slug] 只命中 /docs/...。
 */
const docs = defineCollection({
	loader: docsLoader({
		generateId: ({ entry }) =>
			'docs/' +
			entry
				.split('.')
				.slice(0, -1)
				.join('.'),
	}),
	// 扩展 Starlight schema,加入维基分类字段 categories(用于文档首页分组与文章页标签)。
	schema: docsSchema({
		extend: z.object({
			// 维基分类:每篇文档可挂一个或多个分类,分类名即分组标签。
			categories: z.array(z.string()).optional(),
			// 文章简介一句话,用于文档首页索引与卡片预览。
			excerpt: z.string().optional(),
		}),
	}),
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

export const collections = { docs, tracker };