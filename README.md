# Mirasim 非官方 Wiki — mirasim.wiki

Mirasim（[mirasim.ai](https://mirasim.ai/)，"One Agent IDE"）的非官方多语言 Wiki：产品介绍、最新安装包下载、免费使用各大模型的方式、邀请奖励规则。

- **线上地址**：<https://mirasim.wiki>
- **语言**：14 种 — en（根路径，兼作 x-default）、fr、es、pl、tr、ru、uk、ja、ko、zh、zh-hant、th、vi、id
- **数据自动更新**：GitHub Actions 每 30 分钟从官网抓取版本号、下载链接（含大小与 SHA-256）与资讯，重建并部署

## 结构

```
scripts/config.mjs       语言表、域名、邀请码、方案与模型清单（各脚本共享）
scripts/fetch-data.mjs   抓取 mirasim.ai/download 与 /blog → data/site-data.json
scripts/build.mjs        渲染 14 个语言页面 + sitemap / robots / webmanifest / CNAME
scripts/make-assets.mjs  headless Chrome 生成图标与 OG 卡片 → site/assets/（入库）
scripts/check.mjs        构建后自检：SEO 标签、hreflang、JSON-LD、关键词密度、资源引用
site/template.html       页面模板（占位符注入）
site/i18n/*.json         14 份语言文案，含各语言 SEO 元数据
site/icon.svg            完整字标（含镜像倒影），用于大尺寸图标与 OG 卡片
site/icon-mark.svg       简化字标，用于 favicon 等小尺寸场景
site/assets/             入库的静态产物：图标、favicon.ico、14 张 OG 卡片
```

## 本地构建

```sh
npm run fetch      # 抓取官网数据（stdout 输出 CHANGED / UNCHANGED）
npm run build      # 生成 dist/ 下 14 个语言页面并自检
npm run preview    # 构建后在 http://localhost:8642 预览
npm run assets     # 重新生成图标与 OG 卡片（需要 Chrome，仅在图标/OG 文案改动后运行）

ONLY_LANGS=en,zh node scripts/build.mjs   # 开发时只构建部分语言
```

`site/assets/`（图标、favicon.ico、14 张 OG 卡片）是**入库的静态产物**，不含版本号等易变信息，构建阶段只做复制。因此 `npm run build` 不需要 Chrome，任何构建环境都能跑；只有改了 `site/icon*.svg` 或各语言 `meta.ogSub` 时才需要 `npm run assets` 重新生成并提交。

## 部署

两种方式都已配置好，**域名只能指向其中一个**，二选一即可。

### Vercel

仓库已含 `package.json` 与 `vercel.json`，导入仓库即可，无需在面板里改设置：

- Build Command：`npm run vercel-build`（抓取 → 构建 → 自检）
- Output Directory：`dist`
- Root Directory 保持为仓库根（留空）
- `trailingSlash: true` 是必需的 —— 站点 URL 与 canonical 都带尾斜杠（`/zh/`），Vercel 默认会去掉尾斜杠，那样会和 canonical 不一致

域名 DNS：apex 记录 `A → 76.76.21.21`，或 `CNAME www → cname.vercel-dns.com`。

### GitHub Pages

`.github/workflows/deploy.yml` 在 push 与每 30 分钟的定时任务上构建并部署，`dist/CNAME` 指定自定义域名。

域名 DNS：apex 四条 A 记录指向 `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`。

### 定时更新

GitHub Actions 每 30 分钟抓取官网数据；**数据有变化时会把 `data/site-data.json` 提交回仓库**，这次 push 同时触发 GitHub Pages 与 Vercel 重新部署，因此两个平台都能自动跟上官网的新版本与资讯。抓取失败时退回仓库内已有数据，页面不会开天窗。


## SEO 要点

- 每个语言页面自带 canonical（指向 `https://mirasim.wiki/<lang>/`）、14 个 hreflang 加 x-default
- 结构化数据三组：`WebPage`、`SoftwareApplication`（含版本号、下载地址、各档位 offer）、`FAQPage`
- Open Graph 与 Twitter Card 均带按语言渲染的 1200×630 卡片
- `sitemap.xml` 为每个 URL 声明全部语言 alternates；`robots.txt` 指向 sitemap
- 各语言文案中主关键词自然分布，`check.mjs` 会校验密度落在 0.5%–4% 区间

## 配置

邀请码与域名集中在 `scripts/config.mjs`（`INVITE_CODE`、`SITE`）。改动后重新构建即可，全部 14 个语言页面与 OG 卡片会同步更新。

## 声明

本仓库为社区自发维护的非官方项目，与 Mirasim 官方无隶属关系；所有安装包均由官方 CDN 直接分发，本站不托管任何文件，一切信息以官方页面为准。
