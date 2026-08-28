/**
 * XHPE 编号归一化与硬校验。
 *
 * 背景:Astro 的 glob loader 会把文件名小写化,即 `XHPE-1001.md` 的 entry.id
 * 实际是 `xhpe-1001`。为了让 URL 与展示统一为计划要求的大写规范形 `XHPE-1001`,
 * 这里做一次归一化,同时承担"数据库纪律"校验:
 *   - 必须形如 XHPE + 数字(前缀大小写不敏感,因为 loader 会小写化);
 *   - 编号必须 ≥ 1001。
 * 不合规的 id 直接 throw,构建期即拦截。
 */
export function canonicalXhpeId(id: string): string {
	const m = /^xhpe-(\d+)$/i.exec(id);
	if (!m) {
		throw new Error(`tracker 非法编号格式: "${id}" 须匹配 XHPE-\\d+`);
	}
	const num = parseInt(m[1], 10);
	if (num < 1001) {
		throw new Error(`tracker 编号过小: "${id}" 编号须 ≥ 1001`);
	}
	return 'XHPE-' + num;
}