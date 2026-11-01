/**
 * Xuehai Wiki — 文档加密共享工具(Node 侧)。
 *
 * 被 three 个构建期消费方共用,保证算法唯一事实来源:
 *   - src/utils/rehype-xh-lock.mjs (Markdown 正文加密/涂黑,remark 管线内)
 *   - src/content.config.ts        (frontmatter 涂黑 + xhLock 元数据注入)
 *   - scripts/build-graph.mjs      (graph.json 涂黑 + public/xh-locks.json)
 *
 * 浏览器侧对应实现在 public/xh-lock.js(独立自包含,无法跨端 import);
 * 两侧算法必须逐字节一致,任何修改都要同步两边并跑一遍往返测试。
 *
 * 算法约定(刻意保持零依赖、在 Node 与浏览器中行为一致):
 *   - 加密:明文 UTF-8 字节流与密码 UTF-8 字节流循环 XOR,再手写 Base64 编码。
 *   - 口令校验:FNV-1a 32bit 哈希两次(不同种子/乘数)拼成 16 位十六进制串。
 *     这是"展示层遮蔽"的完整性检查,不是真密码学(见功能文档的说明)。
 *   - 涂黑:每个非空白码点对应一个 '█'(U+2588),空白原样保留以维持版式。
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/* ---------- Base64(手写,避免 Node Buffer 与浏览器实现分叉) ---------- */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** @param {Uint8Array} bytes */
export function base64Encode(bytes) {
	let out = '';
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
		out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = bytes[i] << 16;
		out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + '==';
	} else if (rest === 2) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
		out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + '=';
	}
	return out;
}

/** @param {string} text 标准 Base64(允许含 = 填充) @returns {Uint8Array} */
export function base64Decode(text) {
	const lookup = base64Decode._table ?? (base64Decode._table = buildLookup());
	const clean = text.replace(/[\s=]+/g, '');
	const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let acc = 0;
	let bits = 0;
	let p = 0;
	for (const ch of clean) {
		const v = lookup[ch];
		if (v === undefined) throw new Error(`xh-crypto: 非法 Base64 字符 "${ch}"`);
		acc = (acc << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes[p++] = (acc >> bits) & 0xff;
		}
	}
	return bytes.subarray(0, p);
}

/** @returns {Record<string, number>} */
function buildLookup() {
	/** @type {Record<string, number>} */
	const table = {};
	for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET[i]] = i;
	return table;
}

/* ---------- 核心:XOR 加密 ---------- */

/**
 * 明文与密码做循环 XOR,返回 Base64 密文。
 * @param {string} plain 明文
 * @param {string} password 密码(UTF-8 字节循环使用)
 * @returns {string} Base64 密文
 */
export function encrypt(plain, password) {
	const data = ENCODER.encode(plain);
	const key = ENCODER.encode(password);
	if (key.length === 0) throw new Error('xh-crypto: 密码不能为空');
	const out = new Uint8Array(data.length);
	for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
	return base64Encode(out);
}

/**
 * 解密 encrypt() 的输出。
 * @param {string} cipher Base64 密文
 * @param {string} password 密码
 * @returns {string} 明文(解码失败时由调用方兜底)
 */
export function decrypt(cipher, password) {
	const data = base64Decode(cipher);
	const key = ENCODER.encode(password);
	if (key.length === 0) throw new Error('xh-crypto: 密码不能为空');
	const out = new Uint8Array(data.length);
	for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
	return DECODER.decode(out);
}

/* ---------- 口令哈希 ---------- */

/** FNV-1a 32bit。@param {Uint8Array} bytes @param {number} seed @param {number} prime @returns {number} */
function fnv1a32(bytes, seed, prime) {
	let h = seed >>> 0;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i];
		h = Math.imul(h, prime) >>> 0;
	}
	return h >>> 0;
}

/**
 * 口令校验哈希:两个不同参数的 FNV-1a 32bit 拼成 16 位十六进制串。
 * @param {string} password
 * @returns {string} 16 位十六进制
 */
export function hashPassword(password) {
	const bytes = ENCODER.encode(password);
	const a = fnv1a32(bytes, 0x811c9dc5, 0x01000193);
	const b = fnv1a32(bytes, 0x9747b28c, 0x85ebca6b);
	return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/* ---------- 涂黑 ---------- */

/**
 * 每个非空白码点 → '█';空白字符原样保留。
 * @param {string} text
 * @returns {string}
 */
export function blackMask(text) {
	let out = '';
	for (const ch of text) {
		out += /\s/u.test(ch) ? ch : '█';
	}
	return out;
}

/**
 * 从 Markdown 原文提取 frontmatter 的极简解析(与 build-graph.mjs 同款约定):
 * 仅支持每行 `key: value` 标量,值可带单/双引号。口令/protect 都是标量,足够。
 * @param {string} raw 文件全文
 * @returns {Record<string, string>}
 */
export function parseScalarFrontmatter(raw) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
	/** @type {Record<string, string>} */
	const fm = {};
	if (!match) return fm;
	for (const line of match[1].split(/\r?\n/)) {
		const m = /^([\w-]+):\s*(.*)$/.exec(line.trim());
		if (m) fm[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
	}
	return fm;
}
