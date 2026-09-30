#!/usr/bin/env python3
"""番茄小说（fanqienovel.com）榜单与章节抓取。

关键事实（2026-09 实测）
- 榜单页 https://fanqienovel.com/rank/{channel}_{type}_{categoryId} 是 SSR，
  页面内嵌 `"rank":{"serverRendered":true,"book_list":[...]}`，免签名、免登录。
- 章节页 https://fanqienovel.com/reader/{itemId} 也是 SSR，内嵌 `chapterData`，
  含 title / content / nextItemId / needPay 等；免费章 needPay=0。
- 两者文本里的汉字会被替换成私有区码点（字体混淆），需要用 page 内 @font-face
  指向的子集字体做字形匹配还原（见 font_shield.py）。
"""

from __future__ import annotations

import html as html_mod
import json
import re
import urllib.request

from font_shield import FontShield

BASE = "https://fanqienovel.com"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": BASE + "/",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def embedded_json(html: str, anchor: str):
    """取出页面里被 JS 字符串包裹、且做了一层转义的内嵌 JSON 对象。

    anchor 例如 "chapterData" / "rank"。返回 dict/list，失败返回 None。
    """
    for m in re.finditer(re.escape(anchor) + r'\\?"\s*:', html):
        start = html.find("{", m.end())
        if start < 0:
            continue
        depth, i, in_str, esc = 0, start, False, False
        while i < len(html):
            ch = html[i]
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = not in_str
            elif not in_str:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        break
            i += 1
        raw = html[start:i + 1]
        # 不同页面的内嵌形态不一：rank 是裸 JSON；chapterData 是 JS 字符串转义的 JSON。
        # 依次尝试：直接解析 → JS 字符串解包 → 仅剥 \" 兜底
        try:
            return json.loads(raw, strict=False)
        except Exception:  # noqa: BLE001
            pass
        try:
            text = json.loads('"' + raw + '"', strict=False)
            return json.loads(text, strict=False)
        except Exception:  # noqa: BLE001
            pass
        try:
            return json.loads(raw.replace('\\"', '"'), strict=False)
        except Exception:  # noqa: BLE001
            continue
    return None


def strip_tags(text: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"</p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return html_mod.unescape(text).strip()


# ---------------------------------------------------------------- 榜单

def list_rank(categories: bool = False):
    """榜单入口页，返回 {url_path: 分类名}；categories=True 时返回全部 tab。"""
    page = fetch(BASE + "/rank")
    pairs = re.findall(r'href="(/rank/[0-9_]+)"[^>]*>([^<]{1,20})<', page)
    out: dict[str, str] = {}
    for path, name in pairs:
        out.setdefault(path, name.strip())
    return out


def rank_books(path: str, limit: int = 20, decode: bool = True) -> list[dict]:
    """抓一个榜单页的书籍列表。path 形如 "0_1_1015" 或 "1_1_1014"。

    channel: 0=女频 1=男频；type: 1=热门榜 2=新书榜；末位是分类 id。
    """
    page = fetch(f"{BASE}/rank/{path}")
    data = embedded_json(page, "rank") or {}
    books = data.get("book_list") or []
    if decode:
        shield = FontShield()
        shield.learn_from_html(page, base_url=BASE)
        for book in books:
            for key in ("bookName", "author", "abstract", "lastChapterTitle"):
                if isinstance(book.get(key), str):
                    book[key] = shield.decode(book[key], threshold=0.35)
    return books[:limit]


# ---------------------------------------------------------------- 章节

def chapter(item_id: str, decode: bool = True, shield: FontShield | None = None) -> dict:
    """抓一章。返回 {title, content, next_item_id, need_pay, book_name, word_number}。"""
    page = fetch(f"{BASE}/reader/{item_id}")
    data = embedded_json(page, "chapterData") or {}
    if not data:
        raise RuntimeError(f"chapterData not found for item {item_id}")
    if decode:
        if shield is None:
            shield = FontShield()
        if not shield.mapping:
            shield.learn_from_html(page, base_url=BASE)
        for key in ("title", "content", "bookName", "author"):
            if isinstance(data.get(key), str):
                data[key] = shield.decode(data[key], threshold=0.35)
    return {
        "item_id": str(data.get("itemId") or item_id),
        "book_id": str(data.get("bookId") or ""),
        "book_name": str(data.get("bookName") or ""),
        "title": str(data.get("title") or ""),
        "content": strip_tags(str(data.get("content") or "")),
        "next_item_id": str(data.get("nextItemId") or ""),
        "need_pay": int(data.get("needPay") or 0),
        "word_number": int(data.get("chapterWordNumber") or 0),
    }


def golden_chapters(first_item_id: str, count: int = 3) -> list[dict]:
    """顺序抓取前 count 章（免费章才能取到全文，遇到付费章停止）。"""
    shield = FontShield()  # 同一本书同一字体，跨章复用
    out: list[dict] = []
    item = first_item_id
    while item and len(out) < count:
        ch = chapter(item, shield=shield)
        if ch["need_pay"]:
            out.append({**ch, "content": "", "locked": True})
            break
        out.append(ch)
        item = ch["next_item_id"]
    return out
