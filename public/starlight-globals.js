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
	// 并追加"随机文章"入口 + 折叠切换(desktop 右侧目录才有 starlight-toc)。
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

		// 右侧目录可折叠:把整个 nav 包进可折叠容器,顶部加"本页目录"开关按钮。
		// 折叠状态存 localStorage,刷新后保持。
		if (!tocNav.parentElement.classList.contains('xh-toc-collapsible')) {
			const panel = tocNav.parentElement;
			const wrap = document.createElement('div');
			wrap.className = 'xh-toc-collapsible';
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'xh-toc-toggle';
			btn.setAttribute('aria-expanded', 'true');
			btn.innerHTML =
				'<span>本页目录</span><svg class="xh-toc-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
			panel.insertBefore(wrap, panel.firstChild);
			panel.insertBefore(btn, panel.firstChild);
			wrap.appendChild(tocNav);
			btn.addEventListener('click', () => {
				const isCollapsed = wrap.classList.toggle('is-collapsed');
				btn.setAttribute('aria-expanded', String(!isCollapsed));
				try {
					localStorage.setItem('xh-toc-collapsed', isCollapsed ? '1' : '0');
				} catch {}
			});
			// 恢复上次折叠状态
			let stored = '0';
			try {
				stored = localStorage.getItem('xh-toc-collapsed') || '0';
			} catch {}
			if (stored === '1') {
				wrap.classList.add('is-collapsed');
				btn.setAttribute('aria-expanded', 'false');
			}
		}
	}

	// 维基式左侧文章大纲:把当前文章的标题层级(从右侧目录列表克隆)放进左侧边栏顶部,
	// 便于在文章内快速跳转。子层级可折叠。
	function addArticleOutline() {
		const sidebar = document.querySelector('#starlight__sidebar');
		if (!sidebar) return;
		if (sidebar.querySelector('.xh-side-outline')) return;
		const tocList = document.querySelector('starlight-toc nav > ul');
		if (!tocList) return;

		const panel = document.createElement('div');
		panel.className = 'xh-side-outline';
		const title = document.createElement('p');
		title.className = 'xh-side-outline-title';
		title.textContent = '文章目录';
		panel.appendChild(title);
		panel.appendChild(tocList.cloneNode(true));
		// 放左侧边栏导航之前
		const nav = sidebar.querySelector('nav.sidebar');
		sidebar.insertBefore(panel, nav || null);

		// 子列表可折叠:点击含子级的父项切换子列表显示
		panel.querySelectorAll('li').forEach((li) => {
			const sub = li.querySelector(':scope > ul');
			if (!sub) return;
			li.classList.add('has-sub');
			const link = li.querySelector(':scope > a');
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'xh-side-outline-toggle';
			btn.setAttribute('aria-expanded', 'true');
			btn.setAttribute('aria-label', '切换小节');
			link.parentElement.insertBefore(btn, link.nextSibling);
			btn.addEventListener('click', () => {
				const collapsed = sub.classList.toggle('is-collapsed');
				btn.setAttribute('aria-expanded', String(!collapsed));
				li.classList.toggle('is-collapsed', collapsed);
			});
		});
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
		addArticleOutline();
		setupRandomLinks();
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', run);
	} else {
		run();
	}
})();