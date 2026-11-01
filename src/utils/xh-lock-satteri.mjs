/**
 * Xuehai Wiki — 文档加密(涂黑)rehype 插件。
 *
 * 注册位置:astro.config.mjs -> markdown.rehypePlugins(与 shiki、锚点插件同一条 unified 管线)
 *
 * 装配顺序:shiki 高亮 -> 本插件 -> 标题锚点 id。
 *   - 位于 shiki 之后:代码块已是高亮 span + 纯文本节点,加密文本节点即可在解锁后恢复高亮。
 *   - 位于锚点之前:标题 id 与目录只能看到涂黑文本,不泄漏标题明文。
 *
 * 两种模式(由 frontmatter 决定):
 *   - 部分(partial,只设 password):正文 %%...%% 片段加密为「█」,代码块内不处理。
 *   - 完全(full,protect: full):所有可见文本(含标题、代码、图片 alt、内联 HTML)
 *     逐可见字符涂黑为「█」,空白保留以维持版式。
 *
 * 实现注记:
 *   - Astro 7(Sätteri 管线)会把同一段落拆成多个相邻文本节点(实测在
 *     「:学海最强,」处被切开),跨节点就匹配不到 %%…%%;故先合并相邻文本节点。
 *   - hast 文本节点没有 parent 指针,判定"是否在 code/pre 内"只能靠遍历时下传
 *     的 inCode 标记,不能用 node.parent 向上找。
 */

import { readFileSync } from 'node:fs';
import { encrypt, blackMask, parseScalarFrontmatter } from './xh-crypto.mjs';

/** 密文段标记(用变量拼出,避免本文件自身出现字面标记)。 */
const OPEN = '%' + '%';
const SECRET_PATTERN = /%%([^%](?:[\s\S]*?[^%])?)%%/g;
const HAS_VISIBLE = /[^\s]/u;

/**
 * 从 VFile.path 读回 frontmatter 里的 password / protect。
 * @param {unknown} filePath
 * @returns {{ password?: string, protect?: string } | null}
 */
function readDocSecrets(filePath) {
  if (typeof filePath !== 'string' || !filePath.endsWith('.md')) return null;
  try {
    const fm = parseScalarFrontmatter(readFileSync(filePath, 'utf-8'));
    return fm.password ? fm : null;
  } catch {
    return null;
  }
}

/**
 * 构造加密片段节点。
 * @param {string} plain
 * @param {string} password
 * @param {boolean} isRaw
 * @returns {any}
 */
function secretNode(plain, password, isRaw) {
  const props = {
    className: ['xh-secret'],
    'data-xh-enc': encrypt(plain, password),
  };
  if (isRaw) props['data-xh-raw'] = '1';
  return {
    type: 'element',
    tagName: 'em',
    properties: props,
    children: [{ type: 'text', value: blackMask(plain) }],
  };
}

/**
 * 合并相邻文本节点。上游管线会把一段文字切成多个相邻 text 节点,语义等价;
 * 合并后 %%…%% 才能跨节点匹配。
 * @param {any} node
 */
function mergeAdjacentText(node) {
  if (!node || !Array.isArray(node.children)) return;
  const out = [];
  for (const child of node.children) {
    if (!child) continue;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && child.type === 'text') {
      out[out.length - 1] = { ...prev, value: String(prev.value) + String(child.value) };
      continue;
    }
    out.push(child);
    mergeAdjacentText(child);
  }
  node.children = out;
}

/**
 * 递归处理子树:对每个文本节点调用 fn,fn 返回的数组替换原节点。
 * @param {any} node
 * @param {(text: any, inCode: boolean) => any[] | null} fn
 * @param {boolean} [inCode] 当前是否位于 code/pre 内
 */
function walk(node, fn, inCode = false) {
  if (!node || !Array.isArray(node.children)) return;
  const next = [];
  let i = 0;
  while (i < node.children.length) {
    const child = node.children[i];
    i += 1;
    if (!child) continue;
    if (child.type === 'text') {
      const replaced = fn(child, inCode);
      if (replaced) {
        for (const r of replaced) next.push(r);
      } else {
        next.push(child);
      }
      continue;
    }
    if (child.type === 'raw') {
      next.push(child);
      continue;
    }
    const childInCode = inCode || child.tagName === 'code' || child.tagName === 'pre';
    walk(child, fn, childInCode);
    next.push(child);
  }
  node.children = next;
}

/**
 * 部分模式:把文本里的 %%...%% 拆成伪装与密文片段。
 * @param {any} text
 * @param {string} password
 * @returns {any[] | null}
 */
function splitSecret(text, password) {
  const src = String(text.value);
  if (!src.includes(OPEN)) return null;
  const parts = [];
  let last = 0;
  for (const m of src.matchAll(SECRET_PATTERN)) {
    const start = m.index;
    if (start > last) parts.push({ type: 'text', value: src.slice(last, start) });
    parts.push(secretNode(m[1], password, false));
    last = start + m[0].length;
  }
  if (last < src.length) parts.push({ type: 'text', value: src.slice(last) });
  return parts.length ? parts : null;
}

export default function rehypeXhLock() {
  return (tree, file) => {
    const secrets = readDocSecrets(file.path);
    if (!secrets || !secrets.password) return;
    mergeAdjacentText(tree);
    const password = secrets.password;
    if (secrets.protect === 'full') {
      walk(tree, (text) => {
        if (!HAS_VISIBLE.test(String(text.value))) return null;
        return [secretNode(text.value, password, false)];
      });
      return;
    }
    walk(tree, (text, inCode) => (inCode ? null : splitSecret(text, password)));
  };
}
