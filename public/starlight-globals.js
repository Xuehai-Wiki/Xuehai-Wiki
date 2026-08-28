// Starlight 页面没有自定义 BaseLayout,此脚本在 starlight 页面 head 注入
// (defer:false,同步执行,早于 body 解析):
// 1) 主题初始化(theme-init.js 逻辑,head 前已执行,此处不需要重复);
// 2) 顶部黄色免责 banner(带 X,可关闭,只显示一次);
// 3) 页脚免责声明。样式见 src/styles/global.css 中 banner/footer 段。
// 此文件由 designer A 维护,与 src/pages/404.astro、BaseLayout 中的逻辑保持一致。
// 防闪机制与 BaseLayout 一致:head 同步读 localStorage,已关闭则在 <html> 上加
// data-banner-hidden,由 CSS 先行隐藏(.xh-banner display:none),避免首帧闪现。
(() => {
	const KEY = 'xh-disclaimer-seen';

	// 已关闭过:给 <html> 加标记,CSS 先行隐藏 banner(不渲染也不闪)
	let seen = false;
	try {
		seen = !!localStorage.getItem(KEY);
	} catch {
		/* ignore */
	}
	if (seen) {
		document.documentElement.setAttribute('data-banner-hidden', '');
	}

	function addBanner() {
		if (seen) return;
		const bar = document.createElement('div');
		bar.className = 'xh-banner';
		bar.setAttribute('role', 'status');
		bar.textContent =
			'此网站非学海官方网站,与学海教育及智通云亦不存在从属关系';
		const close = document.createElement('button');
		close.className = 'xh-banner-close';
		close.type = 'button';
		close.setAttribute('aria-label', '关闭提示');
		close.textContent = '×';
		close.addEventListener('click', () => {
			try {
				localStorage.setItem(KEY, '1');
			} catch {
				/* ignore */
			}
			document.documentElement.setAttribute('data-banner-hidden', '');
			bar.remove();
		});
		bar.appendChild(close);
		document.body.prepend(bar);
	}

	// 页脚免责:附加在 starlight 自带 footer 之后
	function addFooterNote() {
		if (document.querySelector('.xh-footer-note')) return;
		const note = document.createElement('div');
		note.className = 'xh-footer-note';
		note.textContent =
			'此网站非学海官方网站,与学海教育及智通云亦不存在从属关系';
		document.body.appendChild(note);
	}

	function run() {
		addBanner();
		addFooterNote();
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', run);
	} else {
		run();
	}
})();