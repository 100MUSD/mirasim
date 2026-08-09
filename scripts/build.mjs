#!/usr/bin/env node
// 读取 data/site-data.json + site/template.html，渲染出 dist/index.html
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INVITE_CODE = "MIRA-EC9V-64BF-BC07"; // 站长邀请码

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const fmtSize = (bytes) => {
  if (!bytes) return "—";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
};

const fmtTime = (iso) => {
  const d = new Date(iso);
  const main = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(d);
  return `${main} (GMT+8)`;
};

const data = JSON.parse(await readFile(path.join(ROOT, "data", "site-data.json"), "utf8"));
let html = await readFile(path.join(ROOT, "site", "template.html"), "utf8");

const downloadRows = data.downloads.map((d) => {
  const sha = d.sha256
    ? `<button class="sha-btn mono" type="button" data-copy="${esc(d.sha256)}" title="点击复制完整校验值：${esc(d.sha256)}">${esc(d.sha256.slice(0, 12))}…</button>`
    : `<span class="stamp">—</span>`;
  return `            <tr>
              <td class="dl-label">${esc(d.label)}<span class="dl-req">${esc(d.req)}</span></td>
              <td class="file mono">${esc(d.file)}</td>
              <td class="num mono">${fmtSize(d.size)}</td>
              <td>${sha}</td>
              <td><a class="dl-link" href="${esc(d.url)}">下载 ⬇</a></td>
            </tr>`;
}).join("\n");

const newsItems = data.news.map((n) => `        <article class="news">
          <div class="n-meta">${n.kind ? `<span class="n-kind mono">${esc(n.kind.toUpperCase())}</span>` : ""}${n.tag ? `<span class="n-tag">${esc(n.tag)}</span>` : ""}</div>
          <h3>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>` : esc(n.title)}</h3>
          ${n.by ? `<p class="n-by">${esc(n.by)}</p>` : ""}
          ${n.summary ? `<p class="n-sum">${esc(n.summary)}</p>` : ""}
          ${n.url ? `<a class="n-src" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">阅读原文 →</a>` : ""}
        </article>`).join("\n");

const dmg = data.downloads.find((d) => d.id === "dmg") ?? data.downloads[0];
const vars = {
  INVITE_CODE,
  VERSION: data.version,
  UPDATED_AT: fmtTime(data.fetchedAt),
  BUILT_AT: fmtTime(new Date().toISOString()),
  HERO_DMG_URL: dmg?.url ?? "https://mirasim.ai/download",
  HERO_DMG_SIZE: fmtSize(dmg?.size),
  DOWNLOAD_ROWS: downloadRows,
  NEWS_ITEMS: newsItems,
  NEWS_COUNT: String(data.news.length),
};
for (const [key, val] of Object.entries(vars)) html = html.replaceAll(`{{${key}}}`, val);

const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
if (leftover) throw new Error(`模板中存在未替换的占位符: ${[...new Set(leftover)].join(", ")}`);

const out = path.join(ROOT, "dist", "index.html");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`built ${out} (v${data.version}, ${data.news.length} news)`);
