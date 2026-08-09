# Mirasim 非官方 Wiki

Mirasim（[mirasim.ai](https://mirasim.ai/)，"One Agent IDE"）的非官方中文 Wiki：产品介绍、最新安装包下载、免费使用各大模型的方式、邀请升级高级订阅的规则。

**数据自动更新**：GitHub Actions 每 30 分钟从官网抓取最新版本号、下载链接（含大小与 SHA-256）和资讯，重新构建并部署到 GitHub Pages。

## 结构

```
scripts/fetch-data.mjs   抓取 mirasim.ai/download 与 /blog → data/site-data.json
scripts/build.mjs        data/site-data.json + site/template.html → dist/index.html
site/template.html       页面模板（占位符注入动态数据）
data/site-data.json      最近一次抓取的数据（CI 抓取失败时的回退数据）
.github/workflows/deploy.yml   定时抓取 + 构建 + 部署 Pages
```

## 本地构建

```sh
node scripts/fetch-data.mjs   # 抓取最新数据（stdout 输出 CHANGED / UNCHANGED）
node scripts/build.mjs        # 生成 dist/index.html
```

邀请码配置在 `scripts/build.mjs` 顶部的 `INVITE_CODE` 常量。

## 声明

本仓库为社区自发维护的非官方项目，与 Mirasim 官方无隶属或授权关系；所有安装包均由官方 CDN 直接分发，本站不托管任何文件，一切信息以官方页面为准。
