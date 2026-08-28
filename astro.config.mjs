// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Xuehai Docs',
			// Starlight 0.41 无 route 选项;docs 挂载在根路径的 [...slug] 上。
			// 内容 entry id 统一加 'docs/' 前缀(见 src/content.config.ts),使文档只服务于 /docs/*。
			disable404Route: true, // 全站自定义 404 (src/pages/404.astro)
			lastUpdated: true, // 页脚显示 git 最后修改时间
			customCss: ['./src/styles/global.css'],
			components: {
				// 统一 /docs 顶栏与全站 Nav(品牌+链接),右侧保留 Starlight 搜索与主题切换
				Header: './src/components/starlight/Header.astro',
			},
			head: [
				// 主题初始化 + 免责 banner/页脚注入(starlight 页面没有我们的全局布局,
				// 通过此处 head 注入与自定义页面一致的脚本与样式)。由 designer A 负责维护。
				{
					tag: 'script',
					attrs: { src: '/theme-init.js', defer: false },
				},
				{
					tag: 'script',
					attrs: { src: '/starlight-globals.js', defer: false },
				},
				// Starlight 与全站主题打通(同一 html[data-theme] + 双向同步 key)
				{
					tag: 'script',
					attrs: { src: '/starlight-theme-sync.js', defer: false },
				},
			],
		}),
	],
});