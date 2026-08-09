#!/usr/bin/env node
// 由 data/site-data.json + site/i18n/*.json + site/template.html 生成多语言静态站到 dist/。
// 产物：14 个语言页面、sitemap.xml、robots.txt、site.webmanifest、CNAME。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SITE, SITE_NAME, INVITE_CODE, LANGS, MODELS, PLANS } from "./config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// 用于 meta / JSON-LD：去掉文案里的行内标签，只留纯文本
const plain = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const fmtSize = (bytes) => {
  if (!bytes) return "—";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
};

const fmtTime = (iso, locale) => {
  const d = new Date(iso);
  const main = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(d);
  return `${main} (GMT+8)`;
};

const fill = (tpl, vars) => String(tpl ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

const data = JSON.parse(await readFile(path.join(ROOT, "data", "site-data.json"), "utf8"));
const template = await readFile(path.join(ROOT, "site", "template.html"), "utf8");
const dmg = data.downloads.find((d) => d.id === "dmg") ?? data.downloads[0];

// ---------- head 里的 SEO 区块 ----------
function buildHead(L, t, ctx) {
  const url = `${SITE}/${L.path}`;
  const title = plain(t.meta.title);
  const desc = plain(fill(t.meta.description, ctx));
  const ogImg = `${SITE}/assets/og-${L.id}.png`;

  const alternates = LANGS.map((o) =>
    `<link rel="alternate" hreflang="${o.hreflang}" href="${SITE}/${o.path}">`).join("\n");
  const ogAlts = LANGS.filter((o) => o.id !== L.id)
    .map((o) => `<meta property="og:locale:alternate" content="${o.ogLocale}">`).join("\n");

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: L.hreflang,
    mainEntity: t.faq.items.map((q) => ({
      "@type": "Question",
      name: plain(fill(q.q, ctx)),
      acceptedAnswer: { "@type": "Answer", text: plain(fill(q.a, ctx)) },
    })),
  };
  const appLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Mirasim",
    alternateName: "Mirasim Agent IDE",
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "IDE",
    operatingSystem: "macOS 13+ (Apple Silicon), Android",
    softwareVersion: data.version,
    downloadUrl: dmg?.url,
    installUrl: `${SITE}/${L.path}#download`,
    softwareRequirements: "Apple Silicon Mac, macOS 13 or later",
    releaseNotes: "https://mirasim.ai/download",
    url: "https://mirasim.ai/",
    inLanguage: L.hreflang,
    offers: [
      { "@type": "Offer", name: "Invite-only free access", price: "0", priceCurrency: "USD",
        description: plain(fill(t.meta.offerFree, ctx)) },
      ...PLANS.map((p) => ({ "@type": "Offer", name: p.plan, price: p.price.replace("$", ""),
        priceCurrency: "USD", description: `${p.credits} credits / month` })),
    ],
  };
  const pageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": url,
    url,
    name: title,
    description: desc,
    inLanguage: L.hreflang,
    isPartOf: { "@type": "WebSite", "@id": `${SITE}/#website`, name: SITE_NAME, url: `${SITE}/` },
    primaryImageOfPage: { "@type": "ImageObject", url: ogImg, width: 1200, height: 630 },
    dateModified: data.fetchedAt,
    about: { "@type": "SoftwareApplication", name: "Mirasim" },
  };

  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="${esc(plain(t.meta.keywords))}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="${url}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${ogImg}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(plain(t.meta.ogSub))}">
<meta property="og:locale" content="${L.ogLocale}">
${ogAlts}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${ogImg}">
<link rel="icon" href="${ctx.ROOTPATH}favicon.ico" sizes="32x32">
<link rel="icon" type="image/svg+xml" href="${ctx.ASSETS}icon-mark.svg">
<link rel="apple-touch-icon" href="${ctx.ASSETS}apple-touch-icon.png">
<link rel="manifest" href="${ctx.ROOTPATH}site.webmanifest">
<meta name="theme-color" content="#F6F7F5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101815" media="(prefers-color-scheme: dark)">
<script type="application/ld+json">${JSON.stringify(pageLd)}</script>
<script type="application/ld+json">${JSON.stringify(appLd)}</script>
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>`;
}

// ---------- 单语言页面 ----------
function buildPage(L, t) {
  const depth = L.path ? L.path.split("/").filter(Boolean).length : 0;
  const up = "../".repeat(depth);
  const ctx = {
    ASSETS: `${up}assets/`,
    ROOTPATH: up || "./",
    version: data.version,
    updated: fmtTime(data.fetchedAt, L.hreflang),
    built: fmtTime(new Date().toISOString(), L.hreflang),
    count: String(data.news.length),
    code: INVITE_CODE,
    size: fmtSize(dmg?.size),
  };

  // 语言切换用相对路径：线上、GitHub Pages 子路径和本地预览都能正确跳转
  // （head 里的 hreflang 仍用绝对 URL，那是规范要求）
  const relTo = (o) => `${up}${o.path}` || "./";

  const langMenu = LANGS.map((o) => {
    const cur = o.id === L.id;
    return `<a href="${relTo(o)}" hreflang="${o.hreflang}" lang="${o.htmlLang}"${cur ? ' aria-current="true"' : ""}>${esc(o.name)}<span class="l-code">${o.hreflang}</span></a>`;
  }).join("");

  const footLangs = LANGS.map((o) => {
    const cur = o.id === L.id;
    return `<li><a href="${relTo(o)}" hreflang="${o.hreflang}" lang="${o.htmlLang}"${cur ? ' aria-current="true"' : ""}>${esc(o.name)}</a></li>`;
  }).join("");

  const tocItems = t.toc.map((label, i) => {
    const ids = ["intro", "download", "start", "models", "invite", "pricing", "news", "faq"];
    return `<li><a href="#${ids[i]}"><span class="no mono">0${i + 1}</span>${esc(label)}</a></li>`;
  }).join("");

  const introCards = t.intro.cards.map((c) =>
    `<div class="card"><span class="k">${esc(c.k)}</span><h3>${c.h}</h3><p>${c.p}</p></div>`).join("");

  const downloadRows = data.downloads.map((d) => {
    const meta = t.download.pkgs[d.id];
    const sha = d.sha256
      ? `<button class="sha-btn" type="button" data-copy="${esc(d.sha256)}" data-ok="${esc(t.ui.copiedShort)}" title="${esc(d.sha256)}">${esc(d.sha256.slice(0, 12))}…</button>`
      : `<span class="stamp">—</span>`;
    return `<tr><td class="dl-label">${esc(meta?.label ?? d.id)}<span class="dl-req">${esc(meta?.req ?? "")}</span></td>` +
      `<td class="file mono">${esc(d.file)}</td><td class="num mono">${fmtSize(d.size)}</td><td>${sha}</td>` +
      `<td><a class="dl-link" href="${esc(d.url)}" rel="nofollow">${esc(t.ui.download)} ⬇</a></td></tr>`;
  }).join("");

  const steps = t.start.steps.map((s) =>
    `<div class="step"><span class="s-no"></span><div><h3>${fill(s.h, ctx)}</h3><p>${fill(s.p, ctx)}</p></div></div>`).join("");

  const chips = MODELS.map((m) => `<span class="chip">${esc(m)}</span>`).join("");

  const rewards = PLANS.map((p) => {
    const r = t.invite.rewards[p.plan.toLowerCase()];
    const hi = p.plan === "Pro" ? " hi" : "";
    return `<div class="reward${hi}"><div class="r-n">${p.invites} <small>${esc(t.invite.unit)}</small></div>` +
      `<div class="r-plan">${esc(r.plan)}</div><div class="r-worth">${esc(r.worth)}</div></div>`;
  }).join("");

  const pricingRows = PLANS.map((p) => {
    const r = t.pricing.rows[p.plan.toLowerCase()];
    return `<tr><td><b>${p.plan}</b></td><td class="price-hl mono">${p.price}</td>` +
      `<td class="mono">${p.credits} credits</td><td>${esc(r.usage)}</td><td>${esc(r.invite)}</td></tr>`;
  }).join("");

  const newsItems = data.news.map((n) => `<article class="news">
<div class="n-meta">${n.kind ? `<span class="n-kind">${esc(n.kind.toUpperCase())}</span>` : ""}${n.tag ? `<span class="n-tag">${esc(n.tag)}</span>` : ""}</div>
<h3><a href="${esc(n.url)}" target="_blank" rel="noopener nofollow">${esc(n.title)}</a></h3>
${n.by ? `<p class="n-by">${esc(n.by)}</p>` : ""}
${n.summary ? `<p class="n-sum" lang="en">${esc(n.summary)}</p>` : ""}
<a class="n-src" href="${esc(n.url)}" target="_blank" rel="noopener nofollow">${esc(t.news.readMore)} →</a>
</article>`).join("");

  const faqItems = t.faq.items.map((q, i) =>
    `<details${i === 0 ? " open" : ""}><summary>${fill(q.q, ctx)}</summary><p>${fill(q.a, ctx)}</p></details>`).join("");

  const vars = {
    HTML_LANG: L.htmlLang,
    DIR: "ltr",
    HEAD_SEO: buildHead(L, t, ctx),
    ASSETS: ctx.ASSETS,
    LANG_MENU: langMenu,
    FOOT_LANGS: footLangs,
    TOC_ITEMS: tocItems,
    INTRO_CARDS: introCards,
    DOWNLOAD_ROWS: downloadRows,
    START_STEPS: steps,
    MODEL_CHIPS: chips,
    REWARDS: rewards,
    PRICING_ROWS: pricingRows,
    NEWS_ITEMS: newsItems,
    FAQ_ITEMS: faqItems,
    INVITE_CODE,
    HERO_DMG_URL: dmg?.url ?? "https://mirasim.ai/download",
    HERO_DMG_SIZE: ctx.size,
    T_SKIP: t.ui.skip,
    T_OFFER_TITLE: t.offer.title,
    T_OFFER_COND: t.offer.cond,
    T_OFFER_LINK: t.offer.link,
    T_OFFICIAL_SITE: t.ui.officialSite,
    T_LANG_LABEL: t.ui.langLabel,
    T_LANG_NAME: L.name,
    T_TOC_TITLE: t.ui.tocTitle,
    T_TOC_INVITE: t.ui.tocInvite,
    T_HERO_EYEBROW: t.hero.eyebrow,
    T_HERO_H1: t.hero.h1,
    T_HERO_LEDE: fill(t.hero.lede, ctx),
    T_TICKET_LABEL: t.hero.ticketLabel,
    T_TICKET_TIP: t.hero.ticketTip,
    T_TICKET_FOOT: fill(t.hero.ticketFoot, ctx),
    T_COPY: t.ui.copy,
    T_COPIED: t.ui.copied,
    T_CTA_DOWNLOAD: fill(t.hero.ctaDownload, ctx),
    T_CTA_OTHER: t.hero.ctaOther,
    T_CTA_NOTE: t.hero.ctaNote,
    T_INTRO_TITLE: t.intro.title,
    T_INTRO_SUB: t.intro.sub,
    T_INTRO_BODY: t.intro.body,
    T_INTRO_CALLOUT: t.intro.callout,
    T_DL_TITLE: t.download.title,
    T_DL_SUB: fill(t.download.sub, ctx),
    T_DL_TH_PKG: t.download.th.pkg,
    T_DL_TH_FILE: t.download.th.file,
    T_DL_TH_SIZE: t.download.th.size,
    T_DL_TH_SHA: t.download.th.sha,
    T_DL_VERIFY: t.download.verify,
    T_DL_PLATFORMS: t.download.platforms,
    T_START_TITLE: t.start.title,
    T_START_SUB: t.start.sub,
    T_MODELS_TITLE: t.models.title,
    T_MODELS_SUB: t.models.sub,
    T_MODELS_P1: t.models.p1,
    T_MODELS_P2: t.models.p2,
    T_MODELS_CALLOUT1: t.models.callout1,
    T_MODELS_CALLOUT2: t.models.callout2,
    T_INVITE_TITLE: t.invite.title,
    T_INVITE_SUB: t.invite.sub,
    T_INVITE_BODY: t.invite.body,
    T_INVITE_CALLOUT: fill(t.invite.callout, ctx),
    T_PRICING_TITLE: t.pricing.title,
    T_PRICING_SUB: t.pricing.sub,
    T_PR_TH_PLAN: t.pricing.th.plan,
    T_PR_TH_PRICE: t.pricing.th.price,
    T_PR_TH_CREDITS: t.pricing.th.credits,
    T_PR_TH_USAGE: t.pricing.th.usage,
    T_PR_TH_INVITE: t.pricing.th.invite,
    T_PRICING_CALLOUT: t.pricing.callout,
    T_NEWS_TITLE: t.news.title,
    T_NEWS_SUB: fill(t.news.sub, ctx),
    T_NEWS_CALLOUT: t.news.callout,
    T_FAQ_TITLE: t.faq.title,
    T_FAQ_SUB: t.faq.sub,
    T_F_OFFICIAL: t.footer.official,
    T_F_DOWNLOAD: t.footer.download,
    T_F_PRICING: t.footer.pricing,
    T_F_GUIDE: t.footer.guide,
    T_F_BLOG: t.footer.blog,
    T_DISCLAIMER: t.footer.disclaimer,
    T_FOOT_META: fill(t.footer.meta, ctx),
  };

  let html = template;
  for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`{{${k}}}`, v);
  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) throw new Error(`[${L.id}] 模板存在未替换占位符: ${[...new Set(leftover)].join(", ")}`);
  return html;
}

// ---------- 输出 ----------
await mkdir(DIST, { recursive: true });
// ONLY_LANGS=en,zh 可只构建部分语言，便于开发时快速迭代
const only = process.env.ONLY_LANGS?.split(",").map((s) => s.trim()).filter(Boolean);
const targets = only?.length ? LANGS.filter((L) => only.includes(L.id)) : LANGS;
const built = [];
for (const L of targets) {
  const t = JSON.parse(await readFile(path.join(ROOT, "site", "i18n", `${L.id}.json`), "utf8"));
  const html = buildPage(L, t);
  const dir = path.join(DIST, L.path);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), html);
  built.push(`${L.path || "/"} (${(html.length / 1024).toFixed(0)} KB)`);
}

const lastmod = data.fetchedAt.slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.map((L) => `  <url>
    <loc>${SITE}/${L.path}</loc>
    <lastmod>${lastmod}</lastmod>
${LANGS.map((o) => `    <xhtml:link rel="alternate" hreflang="${o.hreflang}" href="${SITE}/${o.path}"/>`).join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>
  </url>`).join("\n")}
</urlset>
`;
await writeFile(path.join(DIST, "sitemap.xml"), sitemap);

await writeFile(path.join(DIST, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

await writeFile(path.join(DIST, "site.webmanifest"), JSON.stringify({
  name: SITE_NAME,
  short_name: "Mirasim",
  description: "Mirasim invite code, downloads and guides.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#101815",
  theme_color: "#0B7A66",
  icons: [
    { src: "/assets/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/assets/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/assets/icon.svg", sizes: "any", type: "image/svg+xml" },
  ],
}, null, 2));

await writeFile(path.join(DIST, "CNAME"), "mirasim.wiki\n");
await writeFile(path.join(DIST, ".nojekyll"), "");

console.log(`built ${targets.length} locales · v${data.version} · ${data.news.length} news`);
console.log(built.join("  "));
