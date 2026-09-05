// @ts-check
// 全站共享 <head> 片段 —— 单一事实来源(single source of truth)。
// 自定义页面(BaseLayout)与 Starlight 页面(astro.config.mjs → starlight.head)
// 都从这里取同一份 head 定义,避免 umami / theme-init 在两处重复。
// 格式采用 Starlight `head` 数组的 { tag, attrs } 结构;BaseLayout 渲染时取其 attrs 值。
// 此模块由规划阶段创建,合并原有 BaseLayout head 与 astro.config head 中的重复项。

/** 全站统计脚本(Umami):website-id 仅此一处定义,勿在别处硬编码 */
export const umamiScript = {
	tag: 'script',
	attrs: {
		src: 'https://cloud.umami.is/script.js',
		defer: true,
		'data-website-id': 'b4795099-d45b-4b35-aa70-3270d7b71ee2',
	},
};

/** 主题初始化脚本(防 FOUC):自定义页与 Starlight 页共用 */
export const themeInitScript = {
	tag: 'script',
	attrs: { src: '/theme-init.js', defer: false },
};

/**
 * 供 astro.config.mjs 的 starlight.head 使用 —— 已是 { tag, attrs } 结构。
 * BaseLayout 渲染时逐项展开成真实 <script> 标签。
 */
export const sharedHead = [umamiScript, themeInitScript];