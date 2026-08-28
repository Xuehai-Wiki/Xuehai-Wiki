// 全站主题初始化:html[data-theme] 读取 localStorage,兜底跟随系统。
// 此脚本同时被自定义页面(BaseLayout)与 Starlight 页面(astro.config head)引用,须保持独立可执行。
(() => {
	try {
		const saved = localStorage.getItem('xh-theme');
		const theme = saved === 'light' || saved === 'dark' ? saved : null;
		if (theme) document.documentElement.setAttribute('data-theme', theme);
	} catch {
		/* 隐私模式下 localStorage 可能不可用,退回系统偏好 */
	}
})();