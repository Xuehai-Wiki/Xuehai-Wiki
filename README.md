![Xuehai-Wiki](https://socialify.git.ci/Xuehai-Wiki/Xuehai-Wiki/image?description=1&font=JetBrains+Mono&forks=1&issues=1&name=1&owner=1&pattern=Plus&pulls=1&stargazers=1&theme=Auto)

学海平板 / 智通云非官方社区维基。记录状态、特性追踪与文档。

**此项目非学海官方项目,与学海教育及智通云亦不存在从属关系。**

## 模块

- [状态](/tracker/) —— 学海特性/故障追踪（XHPE 条目），记录已知行为与隐藏特性。
- [文档](/docs/) —— 使用技巧与已知行为记录等说明文档。
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
- **文档内容**：位于 `src/content/docs/`。

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
