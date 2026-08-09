#!/usr/bin/env node
// 生成站点图标与各语言 OG 卡片：headless Chrome 把 SVG / HTML 截成 PNG，再手工封装 favicon.ico。
// 输出到 dist/assets/。产物随构建提交前请先跑 build.mjs（本脚本只依赖 site/ 与 data/）。
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { INVITE_CODE, LANGS } from "./config.mjs";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "assets");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

async function findChrome() {
  const { access } = await import("node:fs/promises");
  for (const p of [process.env.CHROME_PATH, ...CHROME_CANDIDATES].filter(Boolean)) {
    try { await access(p); return p; } catch { /* 继续找 */ }
  }
  // playwright 缓存里的 chromium（CI 与本地都可能有）
  try {
    const { readdir } = await import("node:fs/promises");
    const base = path.join(os.homedir(), "Library/Caches/ms-playwright");
    const dirs = (await readdir(base)).filter((d) => d.startsWith("chromium-")).sort().reverse();
    for (const d of dirs) {
      const p = path.join(base, d, "chrome-mac/Chromium.app/Contents/MacOS/Chromium");
      try { await access(p); return p; } catch { /* 继续 */ }
    }
  } catch { /* 无缓存 */ }
  throw new Error("找不到 Chrome/Chromium，可设置 CHROME_PATH 环境变量指定");
}

const CHROME = await findChrome();
const TMP = path.join(os.tmpdir(), `mirasim-assets-${process.pid}`);
await mkdir(TMP, { recursive: true });
await mkdir(OUT, { recursive: true });

async function shoot(htmlPath, pngPath, width, height, transparent = false) {
  const args = [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--screenshot=${pngPath}`, `--window-size=${width},${height}`,
  ];
  if (transparent) args.push("--default-background-color=00000000");
  args.push(`file://${htmlPath}`);
  await exec(CHROME, args, { timeout: 90_000 });
}

// 用一层 HTML 包住 SVG，精确控制输出尺寸（直接截 .svg 时 Chrome 会加默认边距）
async function renderIcon(svg, size, outName) {
  const html = `<!doctype html><meta charset="utf-8">
<style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;background:transparent}
svg{width:${size}px;height:${size}px;display:block}</style>${svg}`;
  const htmlPath = path.join(TMP, `icon-${size}.html`);
  const pngPath = path.join(OUT, outName);
  await writeFile(htmlPath, html);
  await shoot(htmlPath, pngPath, size, size, true);
  return pngPath;
}

// ICO 容器直接内嵌 PNG（Windows Vista+ / 所有现代浏览器均支持）
function pngToIco(pngBuffers) {
  const entries = pngBuffers.map(({ size, buf }) => ({ size, buf }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: icon
  header.writeUInt16LE(entries.length, 4); // image count
  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(e.size >= 256 ? 0 : e.size, 0); // width (0 = 256)
    d.writeUInt8(e.size >= 256 ? 0 : e.size, 1); // height
    d.writeUInt8(0, 2);                          // palette
    d.writeUInt8(0, 3);                          // reserved
    d.writeUInt16LE(1, 4);                       // color planes
    d.writeUInt16LE(32, 6);                      // bits per pixel
    d.writeUInt32LE(e.buf.length, 8);            // data size
    d.writeUInt32LE(offset, 12);                 // data offset
    dir.push(d);
    offset += e.buf.length;
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.buf)]);
}

const svg = await readFile(path.join(ROOT, "site", "icon.svg"), "utf8");
// 小尺寸用简化字标：完整版的镜像倒影在 16–48px 下会把主体压得看不清
const svgMark = await readFile(path.join(ROOT, "site", "icon-mark.svg"), "utf8");

// ---- 图标 ----
const ICONS = [
  [16, "favicon-16.png", svgMark], [32, "favicon-32.png", svgMark], [48, "favicon-48.png", svgMark],
  [180, "apple-touch-icon.png", svg], [192, "icon-192.png", svg], [512, "icon-512.png", svg],
];
for (const [size, name, source] of ICONS) {
  await renderIcon(source, size, name);
  console.log(`icon ${name}`);
}
await writeFile(path.join(OUT, "icon.svg"), svg);
await writeFile(path.join(OUT, "icon-mark.svg"), svgMark);

const icoParts = [];
for (const size of [16, 32, 48]) {
  icoParts.push({ size, buf: await readFile(path.join(OUT, `favicon-${size}.png`)) });
}
await writeFile(path.join(ROOT, "dist", "favicon.ico"), pngToIco(icoParts));
console.log("icon favicon.ico");

// ---- 各语言 OG 卡片 ----
const data = JSON.parse(await readFile(path.join(ROOT, "data", "site-data.json"), "utf8"));
const ogTpl = await readFile(path.join(ROOT, "site", "og.template.html"), "utf8");

for (const L of LANGS) {
  const lang = L.id;
  const t = JSON.parse(await readFile(path.join(ROOT, "site", "i18n", `${lang}.json`), "utf8"));
  const html = ogTpl
    .replaceAll("{{ICON_SVG}}", svg)
    // 分隔符前用不换行空格，断行时「·」留在行末而不会跑到下一行开头
    .replaceAll("{{OG_SUB}}", t.meta.ogSub.replace(/ · /g, " · "))
    .replaceAll("{{INVITE_CODE}}", INVITE_CODE)
    .replaceAll("{{VERSION}}", data.version)
    .replace('<html lang="en">', `<html lang="${t.htmlLang}">`);
  const htmlPath = path.join(TMP, `og-${lang}.html`);
  await writeFile(htmlPath, html);
  await shoot(htmlPath, path.join(OUT, `og-${lang}.png`), 1200, 630);
  console.log(`og  og-${lang}.png`);
}

await rm(TMP, { recursive: true, force: true });
console.log(`done: ${ICONS.length} icons + favicon.ico + ${LANGS.length} og cards`);
