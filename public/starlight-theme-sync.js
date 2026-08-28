/**
 * Starlight /docs 页面与全站主题统一。
 *
 * 全站主题(theme-init.js / ThemeToggle):localStorage['xh-theme'] = 'light'|'dark',
 *   渲染依赖 html[data-theme]。
 * Starlight 主题(ThemeSelect / ThemeProvider):localStorage['starlight-theme']
 *   = 'auto'|'light'|'dark',也写 html[data-theme]。
 *
 * 此脚本在 Starlight 页面 head 注入(经 astro.config.mjs),处理同步:
 * 1. 若用户此前用过 Starlight 主题(存了 starlight-theme),把它的实际值同步到 xh-theme,反之亦然;
 * 2. 优先让 xh-theme(全站)成为唯一来源:先读它,再回填 starlight-theme;
 * 3. 之后任一侧切换都会同步另一侧(localStorage 事件 + 各自按钮)。
 */
(() => {
	const XH_KEY = 'xh-theme';
	const SL_KEY = 'starlight-theme';
	const root = document.documentElement;

	const read = (k) => {
		try {
			return localStorage.getItem(k);
		} catch {
			return null;
		}
	};
	const write = (k, v) => {
		try {
			if (v == null || v === 'auto') localStorage.removeItem(k);
			else localStorage.setItem(k, v);
		} catch {
			/* 隐私模式忽略 */
		}
	};
	const systemPref = () =>
		window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

	const syncXhToSl = () => {
		const xh = read(XH_KEY) || systemPref();
		write(SL_KEY, xh);
	};
	const syncSlToXh = () => {
		const sl = read(SL_KEY);
		if (sl === 'auto' || sl === null) {
			write(XH_KEY, systemPref());
			root.setAttribute('data-theme', systemPref());
		} else {
			write(XH_KEY, sl);
			root.setAttribute('data-theme', sl);
		}
	};

	// 初始化:全站来源优先(它存的是明确 light/dark);未存则用系统,并回填两侧。
	const xh = read(XH_KEY);
	const sl = read(SL_KEY);
	if (xh === 'light' || xh === 'dark') {
		root.setAttribute('data-theme', xh);
		write(SL_KEY, xh);
	} else if (sl === 'light' || sl === 'dark') {
		root.setAttribute('data-theme', sl);
		write(XH_KEY, sl);
	} else {
		const p = systemPref();
		root.setAttribute('data-theme', p);
	}

	// 监听另一侧切换
	try {
		window.addEventListener('storage', (e) => {
			if (e.key === XH_KEY) syncXhToSl();
			else if (e.key === SL_KEY) syncSlToXh();
		});
	} catch {
		/* ignore */
	}
	// 全站按钮点击后同步(它在同一页面直接改 html + 写 xh-theme,storage 事件不会触发)
	const toggles = () => document.querySelectorAll('[data-theme-toggle]');
	const obs = new MutationObserver(() => {
		const t = toggles()[0];
		if (t && !t.dataset.xhSynced) {
			t.dataset.xhSynced = '1';
			t.addEventListener('click', () => {
				const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
				write(SL_KEY, next);
			});
		}
	});
	obs.observe(document.body, { childList: true, subtree: true });
	// 清理:页面卸载时断开
	window.addEventListener('pagehide', () => obs.disconnect());
})();