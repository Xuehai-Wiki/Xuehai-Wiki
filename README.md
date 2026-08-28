![Xuehai-Wiki](https://socialify.git.ci/Xuehai-Wiki/Xuehai-Wiki/image?description=1&font=JetBrains+Mono&forks=1&issues=1&name=1&owner=1&pattern=Plus&pulls=1&stargazers=1&theme=Auto)

学海平板 / 智通云非官方社区维基。记录状态、特性追踪与文档。

**此项目非学海官方项目,与学海教育及智通云亦不存在从属关系。**

## 模块

- [状态](/tracker/) —— 学海特性/故障追踪（XHPE 条目），记录已知行为与隐藏特性。
- [文档](/docs/intro) —— 由旧 Next.js 维基应用（`wiki-app/`）整体提供：首页、画廊、API 登录、破碎数据研究组资料，以及旧维基的完整样式与功能（侧边栏、搜索、标签、回链、本地关系图、目录、代码复制、wikilink/callout/KaTeX/mermaid 渲染、亮暗主题）。
- [首页](/index) —— 站点入口。




## 开发

```bash
npm run dev      # 启动开发服务器
npm run build    # 构建静态站点
npm run preview  # 预览构建产物
```

## 内容贡献

- **XHPE 提交**：通过 [GitHub Issue 模板](.github/ISSUE_TEMPLATE/xhpe.yml) 提交新的特性/故障追踪条目。
- **Tracker 内容**：位于 `src/content/tracker/`，每个条目一个 Markdown 文件（XHPE-XXXX.md）。
- **文档内容**：位于 `wiki-app/content/`（旧维基的 Markdown 与 wikilink）。碎数研资料（动态码、签名、登录 API 解析）也在其中。

## 架构：双应用

本站由两个独立应用组成：

- **Astro 站点**（仓库根目录）：承载 `/`（首页）、`/status`、`/tracker`、`/404`。
- **旧 Next.js 维基**（`wiki-app/`）：承载 `/docs`。把旧维基完整迁入（样式 + 功能 + 内容），配置了 `basePath: '/docs'`，以静态导出的方式与 Astro 站点合并部署。

Astro 侧已移除 Starlight 文档集成，避免与 `wiki-app` 的 `/docs` 路由冲突。

## 构建 / 部署

需要分别安装依赖并构建两个应用，再把 Next 的静态导出合并进 Astro 输出。

```bash
# 1) 安装两个应用的依赖
npm install
npm run wiki:install

# 2) 构建旧维基（静态导出到 wiki-app/out，默认挂在 /docs 下）
NEXT_PUBLIC_BASE_PATH=/docs npm --prefix wiki-app run build

# 3) 构建 Astro 站点（输出到 dist/）
npm run build

# 4) 合并部署：把 wiki-app/out/* 复制到 dist/docs/ 下，再整体部署 dist/
#    例如（Cloudflare Pages / 任意静态托管均可）:
#    robocopy wiki-app/out dist/docs /E /NFL /NDL /NJH
```

> 说明：`wiki-app/next.config.js` 已把默认 `basePath` 设为 `/docs`，因此即使不传环境变量，旧维基也会挂到 `/docs`。

## 主题

支持亮/暗主题切换，可在页面右上角切换。

## 图片

如需在 tracker 或文档正文中插入示意图，将图片放入 `public/images/tracker/`，正文用绝对路径引用：

```markdown
![示意](/images/tracker/xxx.png)
```

## 统计信息

![Alt](https://repobeats.axiom.co/api/embed/b4efec409d6d6ec64384086af1c6ea471f921173.svg "Repobeats analytics image")

![](https://count.getloli.com/@Kuinone?name=Kuinone&theme=rule34&padding=1&offset=0&align=center&scale=1&pixelated=1&darkmode=auto)
