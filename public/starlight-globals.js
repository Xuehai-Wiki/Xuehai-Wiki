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

	// 维基式右侧目录强化:把文章顶栏的分类标签克隆进 TOC,
	// 并追加"随机文章"入口(desktop 右侧目录才有 starlight-toc)。
	function enhanceToc() {
		const tocNav = document.querySelector('starlight-toc nav');
		if (!tocNav) return;
		if (tocNav.querySelector('.xh-toc-cats') || tocNav.querySelector('.xh-toc-foot')) return;

		// 分类标签:从 PageTitle 渲染的分类芯片里读取文本,重建一批
		const sourceCats = document.querySelectorAll('.xh-wiki-meta-cats .xh-wiki-tag');
		if (sourceCats.length > 0) {
			const cats = document.createElement('p');
			cats.className = 'xh-toc-cats';
			sourceCats.forEach((src) => {
				const a = document.createElement('a');
				a.className = 'xh-toc-tag';
				a.href = src.getAttribute('href') || '/docs';
				a.textContent = src.textContent || '';
				cats.appendChild(a);
			});
			tocNav.insertBefore(cats, tocNav.firstChild);
		}

		// 随机文章:追加到目录底部
		const foot = document.createElement('p');
		foot.className = 'xh-toc-foot';
		const a = document.createElement('a');
		a.className = 'xh-toc-random';
		a.href = '/docs';
		a.textContent = '随机文章';
		foot.appendChild(a);
		tocNav.appendChild(foot);
	}

	// 随机文章:让所有 .xh-wiki-random / .xh-toc-random 链接真正跳到随机文档。
	// 从 graph.json 读取全部文档节点,排除当前页与门户页,随机挑一个跳转。
	let randomLinksReady = false;
	function setupRandomLinks() {
		if (randomLinksReady) return;
		randomLinksReady = true;
		const links = document.querySelectorAll('.xh-wiki-random, .xh-toc-random');
		if (links.length === 0) return;
		fetch('/graph.json')
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null)
			.then((graph) => {
				const nodes = (graph?.nodes ?? []).filter(
					(n) => n.id !== 'docs/index' && n.url !== location.pathname,
				);
				links.forEach((link) => {
					link.addEventListener('click', (ev) => {
						ev.preventDefault();
						if (nodes.length === 0) {
							window.location.href = '/docs';
							return;
						}
						const pick = nodes[Math.floor(Math.random() * nodes.length)];
						window.location.href = pick.url;
					});
				});
			});
	}

	function run() {
		addBanner();
		addFooterNote();
		enhanceToc();
		setupRandomLinks();
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', run);
	} else {
		run();
	}
})();