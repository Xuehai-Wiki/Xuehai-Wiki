// CDP 诊断:连上 Edge 的调试端口,导航到目标页,执行 JS 诊断并打印 JSON
const PORT = process.argv[2] || "9344";
const URL = process.argv[3] || "http://127.0.0.1:8932/docs/xuehai-arrays/";

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) { console.error("NO_PAGE_TARGET"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
await new Promise((r) => (ws.onopen = r));

await send("Page.enable");
await send("Runtime.enable");
const loaded = new Promise((r) => {
  ws.addEventListener("message", (ev) => {
    if (JSON.parse(ev.data).method === "Page.loadEventFired") r();
  });
});
await send("Page.navigate", { url: URL });
await Promise.race([loaded, new Promise((r) => setTimeout(r, 8000))]);
await new Promise((r) => setTimeout(r, 1500)); // 等自定义元素/脚本跑完

const DIAG = `
(() => {
  const pick = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      display: s.display, visibility: s.visibility, opacity: s.opacity,
      position: s.position, width: s.width, height: s.height,
      zIndex: s.zIndex, overflow: s.overflow,
    };
  };
  const q = (sel) => document.querySelector(sel);
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    url: location.href,
    htmlAttrs: [...document.documentElement.attributes].map((a) => a.name),
    rightSidebarContainer: pick(q(".right-sidebar-container")),
    rightSidebar: pick(q(".right-sidebar")),
    starlightToc: pick(q("starlight-toc")),
    tocNav: pick(q("starlight-toc nav")),
    tocHead: pick(q(".xh-toc-head")),
    tocBody: pick(q(".xh-toc-body")),
    tocBodyDisplay: q(".xh-toc-body") ? getComputedStyle(q(".xh-toc-body")).display : null,
    tocDataOpen: q("starlight-toc")?.hasAttribute("data-toc-open") ?? null,
    mainPane: pick(q(".main-pane")),
    lgFlex: pick(q(".main-frame > .lg\\\\:sl-flex")),
    lgFlexCols: getComputedStyle(q(".main-frame > .lg\\\\:sl-flex")).gridTemplateColumns,
    slContainer: pick(q(".right-sidebar .sl-container")),
    tocH2: pick(q("starlight-toc .xh-toc-body > h2")),
    tocH2Display: q("starlight-toc .xh-toc-body > h2") ? getComputedStyle(q("starlight-toc .xh-toc-body > h2")).display : null,
    tocFirstLinks: [...document.querySelectorAll("starlight-toc nav a")].slice(0, 3).map((a) => a.textContent.trim()),
    slContentLoaded: !!q(".sl-markdown-content"),
  };
})()`;

const res = await send("Runtime.evaluate", { expression: DIAG, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(res.result?.value ?? res, null, 2));
ws.close();
process.exit(0);