// 站点级共享配置：build / check / make-assets 都从这里取，避免互相 import 时触发构建。
export const SITE = "https://mirasim.wiki";
export const SITE_NAME = "Mirasim Wiki";
export const INVITE_CODE = "MIRA-EC9V-64BF-BC07";

// 顺序即语言菜单顺序；path 为空表示站点根（英文同时充当 x-default）
export const LANGS = [
  { id: "en",      htmlLang: "en",      hreflang: "en",      ogLocale: "en_US", name: "English",          path: "" },
  { id: "fr",      htmlLang: "fr",      hreflang: "fr",      ogLocale: "fr_FR", name: "Français",         path: "fr/" },
  { id: "es",      htmlLang: "es",      hreflang: "es",      ogLocale: "es_ES", name: "Español",          path: "es/" },
  { id: "pl",      htmlLang: "pl",      hreflang: "pl",      ogLocale: "pl_PL", name: "Polski",           path: "pl/" },
  { id: "tr",      htmlLang: "tr",      hreflang: "tr",      ogLocale: "tr_TR", name: "Türkçe",           path: "tr/" },
  { id: "ru",      htmlLang: "ru",      hreflang: "ru",      ogLocale: "ru_RU", name: "Русский",          path: "ru/" },
  { id: "uk",      htmlLang: "uk",      hreflang: "uk",      ogLocale: "uk_UA", name: "Українська",       path: "uk/" },
  { id: "ja",      htmlLang: "ja",      hreflang: "ja",      ogLocale: "ja_JP", name: "日本語",            path: "ja/" },
  { id: "ko",      htmlLang: "ko",      hreflang: "ko",      ogLocale: "ko_KR", name: "한국어",             path: "ko/" },
  { id: "zh",      htmlLang: "zh-Hans", hreflang: "zh-Hans", ogLocale: "zh_CN", name: "简体中文",          path: "zh/" },
  { id: "zh-hant", htmlLang: "zh-Hant", hreflang: "zh-Hant", ogLocale: "zh_TW", name: "繁體中文",          path: "zh-hant/" },
  { id: "th",      htmlLang: "th",      hreflang: "th",      ogLocale: "th_TH", name: "ไทย",               path: "th/" },
  { id: "vi",      htmlLang: "vi",      hreflang: "vi",      ogLocale: "vi_VN", name: "Tiếng Việt",       path: "vi/" },
  { id: "id",      htmlLang: "id",      hreflang: "id",      ogLocale: "id_ID", name: "Bahasa Indonesia", path: "id/" },
];

// 官方定价页列出的可用模型；专有名词不本地化
export const MODELS = ["Claude", "Codex / GPT", "Gemini", "Grok", "DeepSeek", "Kimi",
  "Qwen", "GLM", "Doubao", "MiniMax", "Mistral", "Llama"];

export const PLANS = [
  { plan: "Basic", price: "$29",  credits: "4,000",  invites: 3  },
  { plan: "Pro",   price: "$89",  credits: "20,000", invites: 5  },
  { plan: "Max",   price: "$199", credits: "80,000", invites: 10 },
];

// 站点页面：每个页面 × 每种语言各自成一个可索引 URL，针对不同搜索意图
// path 为空表示该语言的首页；nav 决定是否出现在顶栏导航
export const PAGES = [
  { id: "home",     path: "",            nav: true },
  { id: "download", path: "download/",   nav: true },
  { id: "windows",  path: "windows/",    nav: true },
  { id: "invite",   path: "invite-code/", nav: true },
];

// 第三方 Windows 更新器（社区项目，非官方）——页面上必须如实标注性质与风险
export const WIN_UPDATER = {
  repo: "https://github.com/Adularia-Z/mirasim-win-updater",
  releases: "https://github.com/Adularia-Z/mirasim-win-updater/releases/latest",
  author: "Adularia-Z",
  license: "MIT",
};

// 语言 + 页面的组合数，构建后自检用
export const totalPages = () => LANGS.length * PAGES.length;

