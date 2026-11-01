/**
 * Xuehai Wiki — 文档身份校验(涂黑加密)运行时。
 *
 * 自包含(Starlight head 与全站 BaseLayout 都只挂这一个文件),
 * 加密基元与 src/utils/xh-crypto.mjs 逐字节一致,修改必须同步。
 *
 * 职责:
 *   1. 解锁横幅交互:点击解锁 → 输入密码 → FNV 哈希比对 → 解密。
 *   2. 解密当前页:所有 [data-xh-enc] 片段还原为明文文本/HTML,
 *      img[data-xh-img] 恢复 alt 并取消隐藏,<h1>/<title>/meta description
 *      用横幅携带的标题密文恢复(保留 " | Xuehai Docs" 后缀)。
 *   3. 跨页恢复:拉取 /xh-locks.json,对侧栏、上下篇、反向链接等
 *      href 命中已解锁文档且文本为对应长度全「█」的锚点,还原标题;
 *      文档首页卡片用 data-xh-doc/data-xh-field 显式还原标题与摘要。
 *   4. 记忆与重锁:localStorage 'xh-lock-pw:<docId>' 存密码,解锁自动
 *      应用到后续页面;「重新上锁」清除记录并整页刷新。
 */
(function () {
	'use strict';

	/* ============ 加密基元(与 xh-crypto.mjs 保持一致) ============ */

	var B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	var B64_LOOKUP = (function () {
		var t = {};
		for (var i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET[i]] = i;
		return t;
	})();

	function base64Decode(text) {
		var clean = String(text).replace(/[\s=]+/g, '');
		var bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
		var acc = 0;
		var bits = 0;
		var p = 0;
		for (var i = 0; i < clean.length; i++) {
			var v = B64_LOOKUP[clean[i]];
			if (v === undefined) throw new Error('bad base64');
			acc = (acc << 6) | v;
			bits += 6;
			if (bits >= 8) {
				bits -= 8;
				bytes[p++] = (acc >> bits) & 0xff;
			}
		}
		return bytes.subarray(0, p);
	}

	function fnv1a32(bytes, seed, prime) {
		var h = seed >>> 0;
		for (var i = 0; i < bytes.length; i++) {
			h ^= bytes[i];
			h = Math.imul(h, prime) >>> 0;
		}
		return h >>> 0;
	}

	var ENCODER = new TextEncoder();
	var DECODER = new TextDecoder();

	function hashPassword(password) {
		var bytes = ENCODER.encode(password);
		var a = fnv1a32(bytes, 0x811c9dc5, 0x01000193);
		var b = fnv1a32(bytes, 0x9747b28c, 0x85ebca6b);
		return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
	}

	function decrypt(cipher, password) {
		var data = base64Decode(cipher);
		var key = ENCODER.encode(password);
		if (key.length === 0) throw new Error('empty password');
		var out = new Uint8Array(data.length);
		for (var i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
		return DECODER.decode(out);
	}

	/* ============ 状态 ============ */

	/** @type {Record<string, any> | null} */ var LOCKS = null;
	var locksPromise = null;

	function pwKey(id) {
		return 'xh-lock-pw:' + id;
	}
	function getStoredPw(id) {
		try {
			return localStorage.getItem(pwKey(id));
		} catch (e) {
			return null;
		}
	}
	function setStoredPw(id, pw) {
		try {
			localStorage.setItem(pwKey(id), pw);
		} catch (e) {
			/* 隐私模式等场景下不可写,仅影响记忆功能 */
		}
	}
	function clearStoredPw(id) {
		try {
			localStorage.removeItem(pwKey(id));
		} catch (e) {
			/* 同上 */
		}
	}

	function fetchLocks() {
		if (LOCKS) return Promise.resolve(LOCKS);
		if (!locksPromise) {
			locksPromise = fetch('/xh-locks.json')
				.then(function (r) {
					return r.ok ? r.json() : {};
				})
				.catch(function () {
					return {};
				})
				.then(function (j) {
					LOCKS = j && typeof j === 'object' ? j : {};
					return LOCKS;
				});
		}
		return locksPromise;
	}

	/* ============ DOM 解密 ============ */

	/** 还原所有加密片段;img 恢复 alt 并取消隐藏。 */
	function decryptTree(root, pw) {
		var nodes = Array.prototype.slice.call(root.querySelectorAll('[data-xh-enc]'));
		for (var i = 0; i < nodes.length; i++) {
			var el = nodes[i];
			var enc = el.getAttribute('data-xh-enc');
			if (!enc) continue;
			var plain;
			try {
				plain = decrypt(enc, pw);
			} catch (e) {
				continue; // 单个片段损坏不阻断整体解锁
			}
			if (el.getAttribute('data-xh-raw') === '1') {
				// 原始 HTML 片段(如 markdown 里的内联 HTML),按 HTML 还原。
				var holder = document.createElement('template');
				holder.innerHTML = plain;
				el.replaceWith(holder.content);
			} else {
				el.replaceWith(document.createTextNode(plain));
			}
		}
		var imgs = Array.prototype.slice.call(root.querySelectorAll('img[data-xh-img]'));
		for (var j = 0; j < imgs.length; j++) {
			var img = imgs[j];
			var altEnc = img.getAttribute('data-xh-alt');
			if (altEnc) {
				try {
					img.setAttribute('alt', decrypt(altEnc, pw));
				} catch (e) {
					/* 保留涂黑 alt */
				}
			}
			img.removeAttribute('data-xh-img');
			img.removeAttribute('data-xh-alt');
		}
	}

	/**
	 * 判断 text 是否为"长度 len 的涂黑标题"(仅 █ 与空白,且含 █)。
	 * 这是侧栏/上下篇/反链等 Starlight 渲染锚点的还原指纹。
	 */
	function isBlacked(text, len) {
		var chars = Array.from(text);
		if (chars.length !== len) return false;
		var hasBlock = false;
		for (var i = 0; i < chars.length; i++) {
			if (chars[i] === '█') {
				hasBlock = true;
			} else if (!/\s/.test(chars[i])) {
				return false;
			}
		}
		return hasBlock;
	}

	/**
	 * 结构保持式文本替换:把节点内文本(可能分散在 span 中)整体换成 plain。
	 * @returns {boolean} 是否命中并替换
	 */
	function replaceBlackedText(node, plain, len) {
		var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
		/** @type {Text[]} */ var texts = [];
		var combined = '';
		var t;
		while ((t = walker.nextNode())) {
			texts.push(/** @type {Text} */ (t));
			combined += t.nodeValue;
		}
		if (!isBlacked(combined, len)) return false;
		texts[0].nodeValue = plain;
		for (var i = 1; i < texts.length; i++) texts[i].nodeValue = '';
		return true;
	}

	/** 跨页恢复:侧栏/上下篇/反链按 href+涂黑指纹还原标题。 */
	function restoreCrossPage() {
		return fetchLocks().then(function (locks) {
			if (!LOCKS) return;
			var anchors = document.querySelectorAll('a[href^="/docs/"]');
			for (var i = 0; i < anchors.length; i++) {
				var a = /** @type {HTMLAnchorElement} */ (anchors[i]);
				var href = (a.getAttribute('href') || '').split('#')[0].split('?')[0];
				var lock = locks[href];
				if (!lock || !lock.t || !lock.tl || !lock.id || !lock.h) continue;
				var pw = getStoredPw(lock.id);
				if (!pw || hashPassword(pw) !== lock.h) continue;
				var plain;
				try {
					plain = decrypt(lock.t, pw);
				} catch (e) {
					continue;
				}
				replaceBlackedText(a, plain, lock.tl);
			}
			// 文档首页卡片:显式 data 属性(锚点内含标题+摘要,不满足指纹条件)。
			var cards = document.querySelectorAll('[data-xh-doc]');
			for (var k = 0; k < cards.length; k++) {
				var el = /** @type {HTMLElement} */ (cards[k]);
				var lock2 = locks[lockHrefOf(el)] || findLockById(locks, el.getAttribute('data-xh-doc'));
				if (!lock2) continue;
				var pw2 = getStoredPw(lock2.id);
				if (!pw2 || hashPassword(pw2) !== lock2.h) continue;
				var fields = el.querySelectorAll('[data-xh-field]');
				for (var m = 0; m < fields.length; m++) {
					var field = fields[m].getAttribute('data-xh-field');
					var enc2 = lock2[field];
					if (!enc2) continue;
					try {
						fields[m].textContent = decrypt(enc2, pw2);
					} catch (e) {
						/* 忽略 */
					}
				}
			}
		});
	}

	/** 优先用链接上的 data-xh-doc-href(首页卡片同时是 <a> 时)定位锁。 */
	function lockHrefOf(el) {
		var href = el.getAttribute('data-xh-doc-href') || (/** @type {HTMLAnchorElement} */ (el.closest && el.closest('a')) || {}).getAttribute?.('href') || '';
		return href.split('#')[0].split('?')[0];
	}

	function findLockById(locks, id) {
		if (!id) return null;
		for (var key in locks) {
			if (locks[key].id === id) return locks[key];
		}
		return null;
	}

	/* ============ 解锁横幅 ============ */

	/** 当前页解锁(横幅所在页):解密正文 + 恢复标题/描述 + 切换横幅状态。 */
	function unlockPage(banner, pw, persist) {
		var id = banner.getAttribute('data-xh-id') || '';
		var hash = banner.getAttribute('data-xh-hash') || '';
		if (!id || !hash || hashPassword(pw) !== hash) return false;
		if (persist) setStoredPw(id, pw);
		decryptTree(document, pw);
		// 标题(h1 + <title> 前缀)与 meta description。
		var titleEnc = banner.getAttribute('data-xh-title-enc');
		var titleLen = parseInt(banner.getAttribute('data-xh-title-len') || '0', 10);
		if (titleEnc && titleLen > 0) {
			try {
				var plainTitle = decrypt(titleEnc, pw);
				var h1 = document.querySelector('h1.xh-wiki-title');
				if (h1) replaceBlackedText(h1, plainTitle, titleLen);
				document.title = plainTitle + document.title.replace(/^█+/, '');
			} catch (e) {
				/* 忽略 */
			}
		}
		var descEnc = banner.getAttribute('data-xh-desc-enc');
		var meta = document.querySelector('meta[name="description"]');
		if (descEnc && meta) {
			try {
				meta.setAttribute('content', decrypt(descEnc, pw));
			} catch (e) {
				/* 忽略 */
			}
		}
		// 横幅切换为已解锁态。
		banner.setAttribute('data-xh-state', 'unlocked');
		var label = banner.querySelector('[data-xh-lock-label]');
		if (label) label.textContent = '已解锁 · 本页内容已恢复';
		var unlockBtn = banner.querySelector('[data-xh-unlock]');
		if (unlockBtn) unlockBtn.hidden = true;
		var form = banner.querySelector('.xh-lock-form');
		if (form) form.hidden = true;
		var relockBtn = banner.querySelector('[data-xh-relock]');
		if (relockBtn) relockBtn.hidden = false;
		return true;
	}

	function setupBanner(banner) {
		banner.setAttribute('data-xh-state', 'locked');
		var stored = getStoredPw(banner.getAttribute('data-xh-id') || '');
		if (stored && unlockPage(banner, stored, false)) return;
		// 无有效记忆:显示解锁按钮(横幅默认渲染已含按钮,无需额外处理)。
	}

	/** 事件委托(只绑定一次,跨 astro:page-load 复用)。 */
	function bindEvents() {
		if (bindEvents.done) return;
		bindEvents.done = true;

		document.addEventListener('click', function (ev) {
			var target = /** @type {HTMLElement} */ (ev.target);
			if (!target) return;
			var unlockBtn = target.closest('[data-xh-unlock]');
			if (unlockBtn) {
				var banner = unlockBtn.closest('[data-xh-lock-banner]');
				if (!banner) return;
				var form = banner.querySelector('.xh-lock-form');
				if (form) {
					form.hidden = false;
					unlockBtn.hidden = true;
					var input = form.querySelector('input[type="password"]');
					if (input) input.focus();
				}
				return;
			}
			var cancelBtn = target.closest('[data-xh-cancel]');
			if (cancelBtn) {
				var banner2 = cancelBtn.closest('[data-xh-lock-banner]');
				if (!banner2) return;
				var form2 = banner2.querySelector('.xh-lock-form');
				var unlockBtn2 = banner2.querySelector('[data-xh-unlock]');
				if (form2) {
					form2.hidden = true;
					var err2 = form2.querySelector('.xh-lock-err');
					if (err2) err2.hidden = true;
					var input2 = form2.querySelector('input[type="password"]');
					if (input2) input2.value = '';
				}
				if (unlockBtn2) unlockBtn2.hidden = false;
				return;
			}
			var relockBtn = target.closest('[data-xh-relock]');
			if (relockBtn) {
				var banner3 = relockBtn.closest('[data-xh-lock-banner]');
				var id = banner3 ? banner3.getAttribute('data-xh-id') : '';
				if (id) clearStoredPw(id);
				window.location.reload();
			}
		});

		document.addEventListener('submit', function (ev) {
			var form = /** @type {HTMLElement} */ (ev.target);
			if (!form || !form.classList || !form.classList.contains('xh-lock-form')) return;
			ev.preventDefault();
			var banner = form.closest('[data-xh-lock-banner]');
			if (!banner) return;
			var input = form.querySelector('input[type="password"]');
			var pw = input ? input.value : '';
			if (!pw) return;
			if (unlockPage(banner, pw, true)) {
				restoreCrossPage();
			} else {
				var err = form.querySelector('.xh-lock-err');
				if (err) err.hidden = false;
				if (input) {
					input.value = '';
					input.classList.remove('xh-shake');
					// 强制重启动画
					void input.offsetWidth;
					input.classList.add('xh-shake');
					input.focus();
				}
			}
		});
	}

	/* ============ 入口 ============ */

	function init() {
		bindEvents();
		var banner = document.querySelector('[data-xh-lock-banner]');
		if (banner) setupBanner(banner);
		// 无论有无横幅都尝试跨页恢复(侧栏/首页卡片)。
		restoreCrossPage();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
	document.addEventListener('astro:page-load', init);
})();
