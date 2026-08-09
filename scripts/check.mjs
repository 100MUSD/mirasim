#!/usr/bin/env node
// 构建后自检：JSON-LD 合法性、SEO 标签齐全、关键词密度、hreflang 自洽、sitemap 与资源引用完整。
// 任何一项失败即以非零码退出，CI 会因此中止部署。
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LANGS, SITE, INVITE_CODE } from "./config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const problems = [];
const warnings = [];
const fail = (msg) => problems.push(msg);
const warn = (msg) => warnings.push(msg);

const textOf = (html) => {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  return body.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#x?\d+;/gi, " ").replace(/\s+/g, " ").trim();
};

for (const L of LANGS) {
  const file = path.join(DIST, L.path, "index.html");
  let html;
  try { html = await readFile(file, "utf8"); } catch { fail(`[${L.id}] 缺少页面 ${L.path}index.html`); continue; }
  const tag = `[${L.id}]`;

  // --- 必需的 SEO 标签 ---
  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  if (canonical !== `${SITE}/${L.path}`) fail(`${tag} canonical 应为 ${SITE}/${L.path}，实际 ${canonical}`);
  if (!new RegExp(`<html lang="${L.htmlLang}"`).test(html)) fail(`${tag} html lang 不是 ${L.htmlLang}`);

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  if (!title) fail(`${tag} 缺少 title`);
  if (!/mirasim/i.test(title)) fail(`${tag} title 未包含主关键词 Mirasim`);
  if (title.length > 65) warn(`${tag} title ${title.length} 字符，搜索结果可能被截断`);

  const desc = html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? "";
  if (!desc) fail(`${tag} 缺少 meta description`);
  if (desc.length > 175) warn(`${tag} description ${desc.length} 字符，可能被截断`);
  if (!/mirasim/i.test(desc)) fail(`${tag} description 未包含主关键词`);

  for (const needed of ['name="keywords"', 'property="og:title"', 'property="og:image"',
    'property="og:url"', 'name="twitter:card"', 'rel="apple-touch-icon"', 'rel="manifest"',
    'name="robots"', 'property="og:locale"']) {
    if (!html.includes(needed)) fail(`${tag} 缺少 ${needed}`);
  }

  // --- hreflang：14 个语言 + x-default，且互指一致 ---
  const hreflangs = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)];
  const map = new Map(hreflangs.map((m) => [m[1], m[2]]));
  for (const o of LANGS) {
    if (map.get(o.hreflang) !== `${SITE}/${o.path}`) fail(`${tag} hreflang ${o.hreflang} 缺失或指向错误`);
  }
  if (map.get("x-default") !== `${SITE}/`) fail(`${tag} 缺少正确的 x-default`);

  // --- JSON-LD 必须是合法 JSON，且含关键类型 ---
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (lds.length < 3) fail(`${tag} JSON-LD 区块只有 ${lds.length} 个，应为 3 个`);
  const types = [];
  for (const [, raw] of lds) {
    try { types.push(JSON.parse(raw)["@type"]); }
    catch (e) { fail(`${tag} JSON-LD 解析失败: ${e.message}`); }
  }
  for (const t of ["WebPage", "SoftwareApplication", "FAQPage"]) {
    if (!types.includes(t)) fail(`${tag} JSON-LD 缺少 ${t}`);
  }

  // --- 邀请码务必出现，且模板占位符不得残留 ---
  const codeHits = (html.match(new RegExp(INVITE_CODE, "g")) || []).length;
  if (codeHits < 3) fail(`${tag} 邀请码仅出现 ${codeHits} 次，应在多处醒目展示`);
  if (/\{\{[A-Z_]+\}\}/.test(html)) fail(`${tag} 存在未替换的模板占位符`);
  if (/\{(version|updated|built|count|code|size)\}/.test(html)) fail(`${tag} 存在未替换的文案变量`);

  // --- 关键词密度：Mirasim 应在 0.5%–4% 之间 ---
  const text = textOf(html);
  const words = text.split(/\s+/).filter(Boolean).length;
  const brand = (text.match(/mirasim/gi) || []).length;
  // CJK/泰文不以空格分词，用字符数近似换算成可比的“词”量
  const cjkish = /^(ja|ko|zh|zh-hant|th)$/.test(L.id);
  const denom = cjkish ? Math.round(text.length / 2.2) : words;
  const density = (brand / denom) * 100;
  if (density < 0.5) fail(`${tag} 主关键词密度 ${density.toFixed(2)}% 偏低`);
  if (density > 4) warn(`${tag} 主关键词密度 ${density.toFixed(2)}% 偏高，注意堆砌风险`);

  // --- 语言切换器应指向全部 14 个语言（相对路径） ---
  const depth = L.path ? L.path.split("/").filter(Boolean).length : 0;
  const up = "../".repeat(depth);
  for (const o of LANGS) {
    const rel = `${up}${o.path}` || "./";
    if (!html.includes(`href="${rel}" hreflang="${o.hreflang}"`)) {
      fail(`${tag} 语言切换器缺少 ${o.id}（期望 href="${rel}"）`);
    }
  }

  // --- 引用的本地资源必须存在 ---
  const dir = path.join(DIST, L.path);
  for (const [, href] of html.matchAll(/(?:src|href)="((?:\.\.\/|\.\/)[^"]+)"/g)) {
    try { await access(path.resolve(dir, href)); }
    catch { fail(`${tag} 引用了不存在的资源 ${href}`); }
  }
}

// --- 站点级资源 ---
for (const f of ["sitemap.xml", "robots.txt", "site.webmanifest", "CNAME", "favicon.ico",
  "assets/icon.svg", "assets/icon-mark.svg", "assets/apple-touch-icon.png",
  "assets/icon-192.png", "assets/icon-512.png"]) {
  try { await access(path.join(DIST, f)); } catch { fail(`缺少 ${f}`); }
}
for (const L of LANGS) {
  try { await access(path.join(DIST, "assets", `og-${L.id}.png`)); }
  catch { fail(`缺少 OG 图 assets/og-${L.id}.png`); }
}

const sitemap = await readFile(path.join(DIST, "sitemap.xml"), "utf8");
for (const L of LANGS) {
  if (!sitemap.includes(`<loc>${SITE}/${L.path}</loc>`)) fail(`sitemap 缺少 ${L.id}`);
}
const cname = (await readFile(path.join(DIST, "CNAME"), "utf8")).trim();
if (cname !== SITE.replace("https://", "")) fail(`CNAME 内容 ${cname} 与站点域名不一致`);
if (!(await readFile(path.join(DIST, "robots.txt"), "utf8")).includes(`${SITE}/sitemap.xml`)) {
  fail("robots.txt 未声明 sitemap");
}

for (const w of warnings) console.log(`⚠️  ${w}`);
if (problems.length) {
  console.error(`\n✗ 自检未通过（${problems.length} 项）：`);
  for (const p of problems) console.error(`   ${p}`);
  process.exit(1);
}
console.log(`✓ 自检通过：${LANGS.length} 个语言页面、SEO 标签、JSON-LD、hreflang、资源引用均完整${warnings.length ? `（${warnings.length} 条提示）` : ""}`);
