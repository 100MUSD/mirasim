#!/usr/bin/env node
// 由 data/site-data.json + site/i18n/*.json + site/template.html 生成多语言多页面静态站到 dist/。
// 产物：PAGES × LANGS 个页面、sitemap.xml、robots.txt、site.webmanifest、CNAME。
import { readFile, writeFile, mkdir, cp, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SITE, SITE_NAME, INVITE_CODE, LANGS, MODELS, PLANS, PAGES, WIN_UPDATER } from "./config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const ASSET_SRC = path.join(ROOT, "site", "assets");

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// 用于 meta / JSON-LD：去掉行内标签只留纯文本（<br> 视作空格，避免词粘连）
const plain = (s) => String(s ?? "")
  .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
  .replace(/\s+/g, " ").trim();

const fmtSize = (bytes) => {
  if (!bytes) return "—";
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
};

const fmtTime = (iso, locale) => {
  const main = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(new Date(iso));
  return `${main} (GMT+8)`;
};

const fill = (tpl, vars) => String(tpl ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
// 对整份文案做一次深度替换，避免某处忘了调 fill() 而把 {version} 之类漏到页面上
const deepFill = (v, vars) => {
  if (typeof v === "string") return fill(v, vars);
  if (Array.isArray(v)) return v.map((x) => deepFill(x, vars));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepFill(x, vars)]));
  }
  return v;
};

const data = JSON.parse(await readFile(path.join(ROOT, "data", "site-data.json"), "utf8"));
const template = await readFile(path.join(ROOT, "site", "template.html"), "utf8");
const dmg = data.downloads.find((d) => d.id === "dmg") ?? data.downloads[0];
const vsix = data.downloads.find((d) => d.id === "vsix");

// 语言 + 页面 → 站点相对 URL 片段（如 "zh/download/"）
const slug = (L, P) => `${L.path}${P.path}`;

// ---------- head 里的 SEO 区块 ----------
function buildHead(L, P, t, ctx) {
  const pageT = t.pages[P.id];
  const url = `${SITE}/${slug(L, P)}`;
  const title = plain(fill(pageT.title, ctx));
  const desc = plain(fill(pageT.description, ctx));
  const ogImg = `${SITE}/assets/og-${L.id}.png`;

  const alternates = LANGS.map((o) =>
    `<link rel="alternate" hreflang="${o.hreflang}" href="${SITE}/${slug(o, P)}">`).join("\n");
  const ogAlts = LANGS.filter((o) => o.id !== L.id)
    .map((o) => `<meta property="og:locale:alternate" content="${o.ogLocale}">`).join("\n");

  const ld = [];

  ld.push({
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
    ...(P.id === "home" ? {} : {
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE}/${L.path}` },
          { "@type": "ListItem", position: 2, name: plain(t.nav[P.id]), item: url },
        ],
      },
    }),
  });

  // 下载相关页面声明软件信息，首页也带（品牌主页）
  if (P.id === "home" || P.id === "download" || P.id === "windows") {
    ld.push({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Mirasim",
      alternateName: "Mirasim Agent IDE",
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "IDE",
      operatingSystem: "macOS 13+ (Apple Silicon), Android",
      softwareVersion: data.version,
      downloadUrl: dmg?.url,
      installUrl: `${SITE}/${slug(L, PAGES.find((x) => x.id === "download"))}`,
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
    });
  }

  // 每页只声明本页实际渲染的问答
  const faqItems = pageT.faq ?? (P.id === "home" ? t.faq.items : null);
  if (faqItems?.length) {
    ld.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: L.hreflang,
      mainEntity: faqItems.map((q) => ({
        "@type": "Question",
        name: plain(fill(q.q, ctx)),
        acceptedAnswer: { "@type": "Answer", text: plain(fill(q.a, ctx)) },
      })),
    });
  }

  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="${esc(plain(pageT.keywords))}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="${url}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE}/${P.path}">
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
${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join("\n")}`;
}

// ---------- 复用的内容片段 ----------
function downloadTable(t, ctx) {
  const rows = data.downloads.map((d) => {
    const meta = t.download.pkgs[d.id];
    const sha = d.sha256
      ? `<button class="sha-btn" type="button" data-copy="${esc(d.sha256)}" data-ok="${esc(t.ui.copiedShort)}" title="${esc(d.sha256)}">${esc(d.sha256.slice(0, 12))}…</button>`
      : `<span class="stamp">—</span>`;
    return `<tr><td class="dl-label">${esc(meta?.label ?? d.id)}<span class="dl-req">${esc(meta?.req ?? "")}</span></td>` +
      `<td class="file mono">${esc(d.file)}</td><td class="num mono">${fmtSize(d.size)}</td><td>${sha}</td>` +
      `<td><a class="dl-link" href="${esc(d.url)}" rel="nofollow">${esc(t.ui.download)} ⬇</a></td></tr>`;
  }).join("");
  return `<div class="tablewrap"><table>
<thead><tr><th>${esc(t.download.th.pkg)}</th><th>${esc(t.download.th.file)}</th><th class="num">${esc(t.download.th.size)}</th><th>${esc(t.download.th.sha)}</th><th></th></tr></thead>
<tbody>${rows}</tbody></table></div>`;
}

function ticket(t, ctx) {
  return `<div class="ticket" id="invite-code">
  <div class="ticket-head">
    <span class="t-label mono">${t.hero.ticketLabel}</span>
    <span class="t-tip">${t.hero.ticketTip}</span>
  </div>
  <div class="ticket-row">
    <strong class="ticket-code mono">${INVITE_CODE}</strong>
    <button class="btn-copy" type="button" data-copy="${INVITE_CODE}" data-ok="${esc(t.ui.copied)}">${esc(t.ui.copy)}</button>
  </div>
  <p class="ticket-foot">${fill(t.hero.ticketFoot, ctx)}</p>
</div>`;
}

function secHead(no, title) {
  return `<div class="sec-head"><span class="no mono">${no}</span><h2>${title}</h2></div>`;
}

function stepsBlock(steps, ctx) {
  return `<div class="steps">${steps.map((s) =>
    `<div class="step"><span class="s-no"></span><div><h3>${fill(s.h, ctx)}</h3><p>${fill(s.p, ctx)}</p></div></div>`).join("")}</div>`;
}

function faqBlock(items, ctx) {
  return items.map((q, i) =>
    `<details${i === 0 ? " open" : ""}><summary>${fill(q.q, ctx)}</summary><p>${fill(q.a, ctx)}</p></details>`).join("");
}

// 页面底部互链，既是导航也是内链
function nextCards(L, P, t, ctx) {
  const others = PAGES.filter((o) => o.id !== P.id);
  return `<div class="nextgrid">${others.map((o) => {
    // 必须走 ctx.pageHref，它是语言内相对路径；自行按站点根算会把访客甩到默认语言
    const href = ctx.pageHref(o.id);
    return `<a class="nextcard" href="${href}"><b>${esc(t.nav[o.id])}</b><span>${esc(t.navDesc[o.id])} <span class="arrow">→</span></span></a>`;
  }).join("")}</div>`;
}

// ---------- 各页面主体 ----------
function bodyHome(L, P, t, ctx) {
  const tocIds = ["intro", "download", "start", "models", "invite", "pricing", "news", "faq"];
  const tocItems = t.toc.map((label, i) =>
    `<li><a href="#${tocIds[i]}"><span class="no mono">0${i + 1}</span>${esc(label)}</a></li>`).join("");

  const introCards = t.intro.cards.map((c) =>
    `<div class="card"><span class="k">${esc(c.k)}</span><h3>${c.h}</h3><p>${c.p}</p></div>`).join("");

  const chips = MODELS.map((m) => `<span class="chip">${esc(m)}</span>`).join("");

  const rewards = PLANS.map((p) => {
    const r = t.invite.rewards[p.plan.toLowerCase()];
    return `<div class="reward${p.plan === "Pro" ? " hi" : ""}"><div class="r-n">${p.invites} <small>${esc(t.invite.unit)}</small></div>` +
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

  return `<div class="shell" id="top">
  <nav class="toc" aria-label="${esc(t.ui.tocTitle)}">
    <p class="toc-title">${esc(t.ui.tocTitle)}</p>
    <ol>${tocItems}</ol>
    <p class="toc-invite"><a href="#invite-code">🎟 ${esc(t.ui.tocInvite)}</a></p>
  </nav>

  <main id="main">
    <section class="hero" id="hero">
      <p class="eyebrow mono">${t.hero.eyebrow}</p>
      <h1>${t.hero.h1}</h1>
      <p class="lede">${fill(t.hero.lede, ctx)}</p>
      ${ticket(t, ctx)}
      <div class="hero-cta">
        <a class="btn btn-solid" href="${esc(dmg?.url ?? "https://mirasim.ai/download")}">⬇ ${fill(t.hero.ctaDownload, ctx)}</a>
        <a class="btn btn-ghost" href="${ctx.PAGE_DOWNLOAD}">${esc(t.hero.ctaOther)}</a>
        <span class="hero-note mono">${ctx.size} · ${esc(t.hero.ctaNote)}</span>
      </div>
    </section>

    <section id="intro">
      ${secHead("01", t.intro.title)}
      <p class="sec-sub">${t.intro.sub}</p>
      <p>${t.intro.body}</p>
      <div class="grid2" style="margin-top:18px">${introCards}</div>
      <p class="callout">${t.intro.callout}</p>
    </section>

    <section id="download">
      ${secHead("02", t.download.title)}
      <p class="sec-sub stamp">${fill(t.download.sub, ctx)}</p>
      ${downloadTable(t, ctx)}
      <p class="callout">${t.download.verify}</p>
      <pre class="code">shasum -a 256 -c SHA256SUMS --ignore-missing</pre>
      <p class="callout warn">${t.download.platforms}</p>
      <p class="callout">${fill(t.download.moreLink, ctx)}</p>
    </section>

    <section id="start">
      ${secHead("03", t.start.title)}
      <p class="sec-sub">${t.start.sub}</p>
      ${stepsBlock(t.start.steps, ctx)}
    </section>

    <section id="models">
      ${secHead("04", t.models.title)}
      <p class="sec-sub">${t.models.sub}</p>
      <p>${t.models.p1}</p>
      <p>${t.models.p2}</p>
      <div class="chips">${chips}</div>
      <p class="callout">${t.models.callout1}</p>
      <p class="callout warn">${t.models.callout2}</p>
    </section>

    <section id="invite">
      ${secHead("05", t.invite.title)}
      <p class="sec-sub">${t.invite.sub}</p>
      <div class="reward-grid">${rewards}</div>
      <p style="margin-top:18px">${t.invite.body}</p>
      <p class="callout">${fill(t.invite.callout, ctx)}</p>
    </section>

    <section id="pricing">
      ${secHead("06", t.pricing.title)}
      <p class="sec-sub">${t.pricing.sub}</p>
      <div class="tablewrap"><table>
        <thead><tr><th>${esc(t.pricing.th.plan)}</th><th>${esc(t.pricing.th.price)}</th><th>${esc(t.pricing.th.credits)}</th><th>${esc(t.pricing.th.usage)}</th><th>${esc(t.pricing.th.invite)}</th></tr></thead>
        <tbody>${pricingRows}</tbody>
      </table></div>
      <p class="callout">${t.pricing.callout}</p>
    </section>

    <section id="news">
      ${secHead("07", t.news.title)}
      <p class="sec-sub stamp">${fill(t.news.sub, ctx)}</p>
      <div class="news-list">${newsItems}</div>
      <p class="callout">${t.news.callout}</p>
    </section>

    <section id="faq" class="faq">
      ${secHead("08", t.faq.title)}
      <p class="sec-sub">${t.faq.sub}</p>
      ${faqBlock(t.faq.items, ctx)}
    </section>

    <section id="next">
      ${secHead("09", t.ui.keepReading)}
      ${nextCards(L, P, t, ctx)}
    </section>
  </main>
</div>`;
}

function bodyDownload(L, P, t, ctx) {
  const p = t.pages.download;
  return `<div class="shell" id="top">
  <main id="main" style="max-width:820px">
    <p class="crumbs"><a href="${ctx.PAGE_HOME}">${esc(t.nav.home)}</a><span class="sep">/</span>${esc(t.nav.download)}</p>
    <section class="hero" style="padding-top:26px">
      <p class="eyebrow mono">${esc(p.eyebrow)}</p>
      <h1>${p.h1}</h1>
      <p class="lede">${fill(p.lede, ctx)}</p>
      <div class="hero-cta">
        <a class="btn btn-solid" href="${esc(dmg?.url ?? "https://mirasim.ai/download")}">⬇ ${fill(t.hero.ctaDownload, ctx)}</a>
        <span class="hero-note mono">${ctx.size} · ${esc(t.hero.ctaNote)}</span>
      </div>
    </section>

    <section>
      ${secHead("01", p.tableTitle)}
      <p class="sec-sub stamp">${fill(t.download.sub, ctx)}</p>
      ${downloadTable(t, ctx)}
      <p class="callout warn">${t.download.platforms}</p>
    </section>

    <section>
      ${secHead("02", p.verifyTitle)}
      <p class="sec-sub">${p.verifySub}</p>
      <p class="callout">${t.download.verify}</p>
      <pre class="code">shasum -a 256 -c SHA256SUMS --ignore-missing</pre>
      <p>${fill(p.verifyBody, ctx)}</p>
    </section>

    <section>
      ${secHead("03", p.installTitle)}
      <p class="sec-sub">${t.start.sub}</p>
      ${stepsBlock(t.start.steps, ctx)}
      ${ticket(t, ctx)}
    </section>

    <section>
      ${secHead("04", p.reqTitle)}
      <div class="grid2">${p.reqCards.map((c) =>
        `<div class="card"><span class="k">${esc(c.k)}</span><h3>${c.h}</h3><p>${c.p}</p></div>`).join("")}</div>
      <p class="callout">${fill(p.winLink, ctx)}</p>
    </section>

    <section class="faq">
      ${secHead("05", t.faq.title)}
      ${faqBlock(p.faq, ctx)}
    </section>

    <section>
      ${secHead("06", t.ui.keepReading)}
      ${nextCards(L, P, t, ctx)}
    </section>
  </main>
</div>`;
}

function bodyWindows(L, P, t, ctx) {
  const p = t.pages.windows;
  const facts = p.facts.map((f) =>
    `<div class="fact ${f.ok ? "yes" : "no"}"><span class="f-mark">${f.ok ? "✓" : "✕"}</span><p><b>${f.h}</b><span>${f.p}</span></p></div>`).join("");
  return `<div class="shell" id="top">
  <main id="main" style="max-width:820px">
    <p class="crumbs"><a href="${ctx.PAGE_HOME}">${esc(t.nav.home)}</a><span class="sep">/</span>${esc(t.nav.windows)}</p>
    <section class="hero" style="padding-top:26px">
      <p class="eyebrow mono">${esc(p.eyebrow)}</p>
      <h1>${p.h1}</h1>
      <p class="lede">${fill(p.lede, ctx)}</p>
    </section>

    <section>
      ${secHead("01", p.statusTitle)}
      <p class="sec-sub">${p.statusSub}</p>
      <p>${fill(p.statusBody, ctx)}</p>
      <div class="tablewrap" style="margin-top:16px"><table>
        <thead><tr><th>${esc(p.osTh.os)}</th><th>${esc(p.osTh.state)}</th><th>${esc(p.osTh.note)}</th></tr></thead>
        <tbody>${p.osRows.map((r) =>
          `<tr><td class="dl-label">${esc(r.os)}</td><td>${r.state}</td><td>${r.note}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>

    <section>
      ${secHead("02", p.updaterTitle)}
      <p class="sec-sub">${p.updaterSub}</p>
      <p>${fill(p.updaterBody, ctx)}</p>
      <div class="factlist" style="margin-top:16px">${facts}</div>
      <div class="risk">
        <h3>⚠ ${p.riskTitle}</h3>
        <p>${p.riskIntro}</p>
        <ul>${p.riskPoints.map((x) => `<li>${x}</li>`).join("")}</ul>
      </div>
      <p class="callout" style="margin-top:18px">${fill(p.updaterLinks, ctx)}</p>
    </section>

    <section>
      ${secHead("03", p.optionsTitle)}
      <p class="sec-sub">${p.optionsSub}</p>
      <div class="grid2">${p.options.map((c) =>
        `<div class="card"><span class="k">${esc(c.k)}</span><h3>${c.h}</h3><p>${c.p}</p></div>`).join("")}</div>
      ${ticket(t, ctx)}
    </section>

    <section class="faq">
      ${secHead("04", t.faq.title)}
      ${faqBlock(p.faq, ctx)}
    </section>

    <section>
      ${secHead("05", t.ui.keepReading)}
      ${nextCards(L, P, t, ctx)}
    </section>
  </main>
</div>`;
}

function bodyInvite(L, P, t, ctx) {
  const p = t.pages.invite;
  const rewards = PLANS.map((pl) => {
    const r = t.invite.rewards[pl.plan.toLowerCase()];
    return `<div class="reward${pl.plan === "Pro" ? " hi" : ""}"><div class="r-n">${pl.invites} <small>${esc(t.invite.unit)}</small></div>` +
      `<div class="r-plan">${esc(r.plan)}</div><div class="r-worth">${esc(r.worth)}</div></div>`;
  }).join("");
  return `<div class="shell" id="top">
  <main id="main" style="max-width:820px">
    <p class="crumbs"><a href="${ctx.PAGE_HOME}">${esc(t.nav.home)}</a><span class="sep">/</span>${esc(t.nav.invite)}</p>
    <section class="hero" style="padding-top:26px">
      <p class="eyebrow mono">${esc(p.eyebrow)}</p>
      <h1>${p.h1}</h1>
      <p class="lede">${fill(p.lede, ctx)}</p>
      ${ticket(t, ctx)}
    </section>

    <section>
      ${secHead("01", p.useTitle)}
      <p class="sec-sub">${p.useSub}</p>
      ${stepsBlock(p.useSteps, ctx)}
    </section>

    <section>
      ${secHead("02", p.freeTitle)}
      <p class="sec-sub">${p.freeSub}</p>
      <p>${t.models.p1}</p>
      <p class="callout warn">${t.models.callout2}</p>
    </section>

    <section>
      ${secHead("03", t.invite.title)}
      <p class="sec-sub">${t.invite.sub}</p>
      <div class="reward-grid">${rewards}</div>
      <p style="margin-top:18px">${t.invite.body}</p>
      <p class="callout">${fill(t.invite.callout, ctx)}</p>
    </section>

    <section class="faq">
      ${secHead("04", t.faq.title)}
      ${faqBlock(p.faq, ctx)}
    </section>

    <section>
      ${secHead("05", t.ui.keepReading)}
      ${nextCards(L, P, t, ctx)}
    </section>
  </main>
</div>`;
}

const BODIES = { home: bodyHome, download: bodyDownload, windows: bodyWindows, invite: bodyInvite };

// ---------- 组装单个页面 ----------
function buildPage(L, P, rawT) {
  const depth = slug(L, P).split("/").filter(Boolean).length;
  const up = "../".repeat(depth);              // 到站点根：assets、favicon、语言切换用
  const upInLang = "../".repeat(P.path ? P.path.split("/").filter(Boolean).length : 0);
  // 页面间跳转必须停在当前语言内，否则从 /zh/windows/ 点「下载」会落到英文版
  const pageHref = (id) => {
    const target = PAGES.find((x) => x.id === id);
    return `${upInLang}${target.path}` || "./";
  };

  const ctx = {
    pageHref,
    ASSETS: `${up}assets/`,
    ROOTPATH: up || "./",
    PAGE_HOME: pageHref("home"),
    PAGE_DOWNLOAD: pageHref("download"),
    PAGE_WINDOWS: pageHref("windows"),
    PAGE_INVITE: pageHref("invite"),
    version: data.version,
    updated: fmtTime(data.fetchedAt, L.hreflang),
    built: fmtTime(new Date().toISOString(), L.hreflang),
    count: String(data.news.length),
    code: INVITE_CODE,
    size: fmtSize(dmg?.size),
    vsixFile: vsix?.file ?? "",
    winRepo: WIN_UPDATER.repo,
    winReleases: WIN_UPDATER.releases,
    winAuthor: WIN_UPDATER.author,
  };

  // 文案里的 {version} / {code} / {PAGE_*} 等一次性全部替换掉
  const t = deepFill(rawT, ctx);

  // 语言切换保持在同一页面上，避免跳回首页丢失上下文
  const relLang = (o) => `${up}${o.path === "" ? "" : o.path}${P.path}` || "./";
  const langMenu = LANGS.map((o) => {
    const cur = o.id === L.id;
    return `<a href="${relLang(o)}" hreflang="${o.hreflang}" lang="${o.htmlLang}"${cur ? ' aria-current="true"' : ""}>${esc(o.name)}<span class="l-code">${o.hreflang}</span></a>`;
  }).join("");
  const footLangs = LANGS.map((o) => {
    const cur = o.id === L.id;
    return `<li><a href="${relLang(o)}" hreflang="${o.hreflang}" lang="${o.htmlLang}"${cur ? ' aria-current="true"' : ""}>${esc(o.name)}</a></li>`;
  }).join("");

  const siteNav = PAGES.filter((o) => o.nav).map((o) => {
    const cur = o.id === P.id;
    return `<a href="${pageHref(o.id)}"${cur ? ' aria-current="page"' : ""}>${esc(t.nav[o.id])}</a>`;
  }).join("");

  const vars = {
    HTML_LANG: L.htmlLang,
    DIR: "ltr",
    HEAD_SEO: buildHead(L, P, t, ctx),
    ASSETS: ctx.ASSETS,
    LANG_MENU: langMenu,
    FOOT_LANGS: footLangs,
    SITE_NAV: siteNav,
    BODY: BODIES[P.id](L, P, t, ctx),
    T_SKIP: t.ui.skip,
    T_NAV_LABEL: t.ui.navLabel,
    T_OFFER_TITLE: t.offer.title,
    T_OFFER_COND: t.offer.cond,
    T_OFFER_LINK: t.offer.link,
    T_OFFICIAL_SITE: t.ui.officialSite,
    T_LANG_LABEL: t.ui.langLabel,
    T_LANG_NAME: L.name,
    T_COPY: t.ui.copy,
    T_COPIED: t.ui.copied,
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
  // 优惠条的锚点指向邀请码页面（各页均可用）
  html = html.replaceAll('href="#invite"', `href="${ctx.PAGE_INVITE}"`);
  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) throw new Error(`[${L.id}/${P.id}] 模板存在未替换占位符: ${[...new Set(leftover)].join(", ")}`);
  return html;
}

// ---------- 输出 ----------
await mkdir(DIST, { recursive: true });

// 图标与 OG 卡片是入库的静态产物（由 scripts/make-assets.mjs 生成），
// 构建阶段只做复制，因此无需 Chrome —— Vercel 等构建环境同样能跑。
try {
  await access(ASSET_SRC);
} catch {
  throw new Error("缺少 site/assets/，请先运行 node scripts/make-assets.mjs（需要 Chrome）");
}
await cp(ASSET_SRC, path.join(DIST, "assets"), { recursive: true });
await cp(path.join(ASSET_SRC, "favicon.ico"), path.join(DIST, "favicon.ico"));

// ONLY_LANGS=en,zh 可只构建部分语言，便于开发时快速迭代
const only = process.env.ONLY_LANGS?.split(",").map((s) => s.trim()).filter(Boolean);
const targets = only?.length ? LANGS.filter((L) => only.includes(L.id)) : LANGS;

let count = 0;
for (const L of targets) {
  const t = JSON.parse(await readFile(path.join(ROOT, "site", "i18n", `${L.id}.json`), "utf8"));
  for (const P of PAGES) {
    const html = buildPage(L, P, t);
    const dir = path.join(DIST, slug(L, P));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), html);
    count++;
  }
}

const lastmod = data.fetchedAt.slice(0, 10);
const urls = [];
for (const P of PAGES) {
  for (const L of LANGS) {
    urls.push(`  <url>
    <loc>${SITE}/${slug(L, P)}</loc>
    <lastmod>${lastmod}</lastmod>
${LANGS.map((o) => `    <xhtml:link rel="alternate" hreflang="${o.hreflang}" href="${SITE}/${slug(o, P)}"/>`).join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/${P.path}"/>
  </url>`);
  }
}
await writeFile(path.join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`);

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

console.log(`built ${count} pages · ${targets.length} locales × ${PAGES.length} pages · v${data.version}`);
