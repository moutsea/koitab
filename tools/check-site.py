#!/usr/bin/env python3
"""Check rendered multilingual HTML, reciprocal SEO links, sitemap and RSS.
Run after next build. No browser or third-party Python dependencies required.
"""
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "nextjs"
OUTPUT = APP / ".next/server/app"
ORIGIN = "https://koitab.com"
LANGUAGES = {"zh": "zh-CN", "en": "en", "ja": "ja", "ko": "ko", "la": "la"}
SECTIONS = ("", "features", "guide", "download", "privacy", "faq", "changelog")
VERSION = json.loads((ROOT / "extension/manifest.json").read_text())["version"]


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tags = []
        self.ids = set()
        self.title = ""
        self.jsonld = []
        self.current = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if "id" in attrs:
            assert attrs["id"] not in self.ids, f"Duplicate id: {attrs['id']}"
            self.ids.add(attrs["id"])
        if tag == "title":
            self.current = "title"
        elif tag == "script" and attrs.get("type") == "application/ld+json":
            self.current = "jsonld"

    def handle_endtag(self, tag):
        if tag in ("title", "script"):
            self.current = None

    def handle_data(self, data):
        if self.current == "title":
            self.title += data
        elif self.current == "jsonld":
            self.jsonld.extend(json.loads(data))

    def select(self, tag, **attrs):
        return [a for t, a in self.tags if t == tag and all(a.get(k) == v for k, v in attrs.items())]


def path_for(locale, section):
    return f"/{locale}" + (f"/{section}" if section else "")


def run():
    pages = {}
    titles = set()
    descriptions = set()
    for locale, language in LANGUAGES.items():
        dictionary = json.loads((APP / f"locales/{locale}.json").read_text())
        assert dictionary["releases"][0]["version"] == VERSION, f"Translate latest release for {locale}"
        for section in SECTIONS:
            path = path_for(locale, section)
            html = (OUTPUT / f"{path[1:]}.html").read_text()
            p = pages[path] = Page(html)
            assert p.select("html", lang=language), f"Wrong html lang: {path}"
            assert len(p.select("h1")) == 1, f"Expected one H1: {path}"
            assert p.select("link", rel="canonical") == [{"rel": "canonical", "href": ORIGIN + path}], path
            meta = dictionary["meta"][section or "home"]
            assert p.title == meta["title"], path
            assert p.title not in titles, f"Repeated title: {path}"
            titles.add(p.title)
            description = p.select("meta", name="description")
            assert len(description) == 1 and description[0]["content"] == meta["description"], path
            assert meta["description"] not in descriptions, f"Repeated description: {path}"
            descriptions.add(meta["description"])
            alternates = {a["hreflang"]: a["href"] for a in p.select("link", rel="alternate") if "hreflang" in a}
            expected = {tag: ORIGIN + path_for(l, section) for l, tag in LANGUAGES.items()}
            expected["x-default"] = ORIGIN + path_for("zh", section)
            assert alternates == expected, f"Wrong language alternatives: {path}"
            assert not p.select("meta", name="robots", content="noindex"), path
            assert p.select("meta", property="og:url", content=ORIGIN + path), path
            assert p.select("link", rel="alternate", type="application/rss+xml", href=f"{ORIGIN}/{locale}/feed.xml"), path
            for l, tag in LANGUAGES.items():
                assert p.select("a", href=path_for(l, section), hreflang=tag), f"Language switch loses page: {path} -> {l}"
            assert p.jsonld, f"Missing JSON-LD: {path}"
            for data in p.jsonld:
                if data["@type"] == "SoftwareApplication":
                    assert data["softwareVersion"] == VERSION and data["inLanguage"] == "zh-CN", path
                if data["@type"] == "FAQPage":
                    assert section == "faq" and len(data["mainEntity"]) == len(dictionary["faq"]["items"]), path
                    assert all(item["name"] in html for item in data["mainEntity"]), path
            if section:
                assert any(x["@type"] == "BreadcrumbList" for x in p.jsonld), path
    # Every rendered internal link must lead to a generated page, feed or public file.
    for path, page in pages.items():
        for link in page.select("a"):
            target = urlsplit(link.get("href", ""))
            if target.scheme or target.netloc:
                continue
            dest = target.path or path
            assert dest in pages or (OUTPUT / f"{dest[1:]}.body").is_file() or (APP / "public" / dest[1:]).is_file(), f"Broken link: {path} -> {dest}"
            if target.fragment and dest in pages:
                assert target.fragment in pages[dest].ids, f"Missing anchor: {path} -> {dest}#{target.fragment}"
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "x": "http://www.w3.org/1999/xhtml"}
    sitemap = ET.fromstring((OUTPUT / "sitemap.xml.body").read_text())
    urls = sitemap.findall("s:url", ns)
    assert {u.findtext("s:loc", namespaces=ns) for u in urls} == {ORIGIN + p for p in pages}
    assert len(urls) == len(pages) == 35
    for u in urls:
        assert len(u.findall("x:link", ns)) == 6, "Sitemap must include all languages and x-default"
    for locale, language in LANGUAGES.items():
        channel = ET.fromstring((OUTPUT / f"{locale}/feed.xml.body").read_text()).find("channel")
        assert channel.findtext("language") == language
        for item in channel.findall("item"):
            link = urlsplit(item.findtext("link"))
            assert link.fragment in pages[link.path].ids
    routes = json.loads((APP / ".next/routes-manifest.json").read_text())
    for source, dest in {"/": "/zh", "/changelog": "/zh/changelog", "/feed.xml": "/zh/feed.xml"}.items():
        assert any(r["source"] == source and r["destination"] == dest and r["statusCode"] == 308 for r in routes["redirects"])
    print("PASS: 35 localized pages, unique metadata, language switches, canonical/hreflang, JSON-LD, internal links, 5 feeds, sitemap and 308 redirects.")


if __name__ == "__main__":
    run()
