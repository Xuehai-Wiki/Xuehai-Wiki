// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
// 说明:本站由 Astro 承载首页 / status / tracker / 404;
// 文档页 /docs 由仓库内的旧 Next.js 维基应用(wiki-app/)整体提供,
// 因此这里不再接入 Starlight 文档集成,避免与 wiki-app 的 /docs 路由冲突。
// 构建/部署见 README.md 的「双应用构建」说明。
export default defineConfig({
	site: 'https://xh.asxz.one',
});