#!/usr/bin/env node
// 从 mirasim.ai 官网抓取最新版本、下载链接与资讯，写入 data/site-data.json。
// stdout 最后一行输出 CHANGED / UNCHANGED，供定时任务判断是否需要重新构建发布。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "site-data.json");
const UA = { "user-agent": "mirasim-wiki-updater/1.0 (+unofficial community wiki)" };

async function getText(url) {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function decodeEntities(s) {
  return s
    .replace(/<!--\s*-->/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
const strip = (s) => decodeEntities(s.replace(/<[^>]+>/g, " "));

// ---- 下载页：版本号 + 各安装包 ----
async function fetchDownloads() {
  const html = await getText("https://mirasim.ai/download");
  // CDN 链接可能出现在 JSON 转义字符串里，排除引号/反斜杠/空白作为边界
  const urls = [...new Set(
    [...html.matchAll(/https:\/\/cdn-assets\.mirasim\.ai\/mirasim\/releases\/[^"'\\\s<>)]+/g)].map(m => m[0])
  )];
  if (urls.length === 0) throw new Error("下载页中未找到 CDN 链接，页面结构可能已变化");

  const ver = urls.map(u => u.match(/\/releases\/v([\d.]+)\//)).find(Boolean);
  if (!ver) throw new Error("无法从 CDN 链接解析版本号");
  const version = ver[1];

  // SHA256SUMS：文件名 -> 校验值
  const sums = {};
  const sumsUrl = urls.find(u => u.endsWith("/SHA256SUMS"));
  if (sumsUrl) {
    try {
      const text = await getText(sumsUrl);
      for (const line of text.split("\n")) {
        const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
        if (m) sums[m[2].trim()] = m[1].toLowerCase();
      }
    } catch { /* 校验文件拉取失败不阻塞主流程 */ }
  }

  const CATALOG = [
    { test: /-arm64\.dmg$/,        id: "dmg",  label: "macOS 桌面应用", format: "DMG",     req: "macOS 13+ · Apple Silicon" },
    { test: /darwin-arm64\.tar\.xz$/, id: "cli", label: "命令行版 (CLI)", format: "tar.xz", req: "macOS · Apple Silicon" },
    { test: /\.apk$/,              id: "apk",  label: "Android 应用",   format: "APK",     req: "Android · 需手动侧载安装" },
    { test: /\.vsix$/,             id: "vsix", label: "VS Code 扩展",   format: "VSIX",    req: "VS Code 手动安装扩展" },
    { test: /SHA256SUMS$/,         id: "sums", label: "校验文件",       format: "SHA256",  req: "用于核对下载完整性" },
  ];

  const downloads = [];
  for (const spec of CATALOG) {
    const url = urls.find(u => spec.test.test(u));
    if (!url) continue;
    const file = url.split("/").pop();
    let size = null;
    try {
      const head = await fetch(url, { method: "HEAD", headers: UA });
      const len = head.headers.get("content-length");
      if (head.ok && len) size = Number(len);
    } catch { /* 大小获取失败则留空 */ }
    downloads.push({ id: spec.id, label: spec.label, format: spec.format, req: spec.req, file, url, size, sha256: sums[file] ?? null });
  }
  return { version, downloads };
}

// ---- 博客页：官方 Research notes ----
async function fetchNews() {
  const html = await getText("https://mirasim.ai/blog");
  const news = [];
  for (const [, block] of html.matchAll(/<article>([\s\S]*?)<\/article>/g)) {
    const pick = (re) => { const m = block.match(re); return m ? strip(m[1]) : ""; };
    const title = pick(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!title) continue;
    const paras = [...block.matchAll(/<p(?![^>]*class)[^>]*>([\s\S]*?)<\/p>/g)].map(m => strip(m[1]));
    news.push({
      kind: pick(/<span[^>]*>([\s\S]*?)<\/span>/),
      tag: pick(/<em[^>]*>([\s\S]*?)<\/em>/),
      title,
      by: pick(/<p class="note-by"[^>]*>([\s\S]*?)<\/p>/),
      summary: paras[0] ?? "",
      why: pick(/<p class="note-why"[^>]*>([\s\S]*?)<\/p>/).replace(/^Why we read it\.\s*/, ""),
      url: (block.match(/<a class="note-src" href="([^"]+)"/) || [, ""])[1],
    });
  }
  return news;
}

const [{ version, downloads }, news] = await Promise.all([fetchDownloads(), fetchNews()]);
const data = { version, downloads, news, source: "https://mirasim.ai", fetchedAt: new Date().toISOString() };

let previous = null;
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch { /* 首次运行 */ }
const significant = (d) => JSON.stringify({ v: d.version, dl: d.downloads, n: d.news });
const changed = !previous || significant(previous) !== significant(data);

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data, null, 2) + "\n");
console.log(`version=${version} downloads=${downloads.length} news=${news.length}`);
console.log(changed ? "CHANGED" : "UNCHANGED");
