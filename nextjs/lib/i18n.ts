import zh from "../locales/zh.json";
import en from "../locales/en.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";
import la from "../locales/la.json";

export const locales = ["zh", "en", "ja", "ko", "la"] as const;
export type Locale = (typeof locales)[number];
export const sections = [
  "",
  "features",
  "guide",
  "download",
  "privacy",
  "faq",
  "changelog",
] as const;
export type Section = (typeof sections)[number];
export type Dictionary = typeof zh;
export const dictionaries: Record<Locale, Dictionary> = { zh, en, ja, ko, la };
export const languages = {
  zh: { name: "中文", tag: "zh-CN", og: "zh_CN" },
  en: { name: "English", tag: "en", og: "en_US" },
  ja: { name: "日本語", tag: "ja", og: "ja_JP" },
  ko: { name: "한국어", tag: "ko", og: "ko_KR" },
  la: { name: "Latina", tag: "la", og: "la" },
} as const;
export function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value);
}
export function isSection(value: string): value is Section {
  return sections.some((section) => section === value);
}
export function href(locale: Locale, section: Section = "") {
  return `/${locale}${section ? `/${section}` : ""}`;
}
