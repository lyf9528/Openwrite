#!/usr/bin/env python3
"""扫榜编排：拉榜单 -> 黄金三章 -> Markdown 报告。

用法（stdout 始终输出 JSON 状态行，报告写 --out 或 stdout 第二段）：

  python saobang.py categories                       列出番茄可用榜单分类
  python saobang.py rank <path> [--limit 20]         某榜单的书籍列表（JSON）
  python saobang.py chapters <first_item_id> [--count 3]
  python saobang.py report <path> [--limit 10] [--books 5] [--golden 3] [--out file.md]

<path> 形如 0_1_1015：channel(0女/1男)_type(1热门/2新书)_分类id，见 categories 输出。
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
import time

import fanqie


def _emit(status: dict) -> None:
    print(json.dumps(status, ensure_ascii=False))


def cmd_categories(_args) -> None:
    cats = fanqie.list_rank()
    _emit({"ok": True, "categories": {p.lstrip("/rank/"): n for p, n in sorted(cats.items())}})


def cmd_rank(args) -> None:
    books = fanqie.rank_books(args.path, limit=args.limit)
    _emit({"ok": True, "count": len(books), "books": [
        {
            "rank": i + 1,
            "bookName": b.get("bookName", ""),
            "author": b.get("author", ""),
            "abstract": b.get("abstract", ""),
            "lastChapterTitle": b.get("lastChapterTitle", ""),
            "firstChapterItemId": str(b.get("firstChapterItemId") or ""),
            "bookId": str(b.get("bookId") or ""),
        }
        for i, b in enumerate(books)
    ]})


def cmd_chapters(args) -> None:
    chapters = fanqie.golden_chapters(args.item_id, count=args.count)
    _emit({"ok": True, "count": len(chapters), "chapters": chapters})


def _report_markdown(path: str, cat_name: str, books: list[dict], golden: list[list[dict]]) -> str:
    today = _dt.date.today().isoformat()
    lines: list[str] = [
        f"# 扫榜报告 · 番茄 · {cat_name or path} · {today}",
        "",
        f"> 数据源：番茄小说网实时榜单（{path}）。生成时间 {today}。",
        "",
        "## 榜单概览",
        "",
        "| 排名 | 书名 | 作者 | 最新章节 | 简介 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for i, b in enumerate(books):
        abstract = str(b.get("abstract", "")).replace("|", "\\|").replace("\n", " ")[:80]
        lines.append(
            f"| {i + 1} | {b.get('bookName', '')} | {b.get('author', '')} "
            f"| {str(b.get('lastChapterTitle', ''))[:20]} | {abstract} |"
        )
    lines += ["", "## 黄金三章拆解", ""]
    for i, (b, chapters) in enumerate(zip(books, golden)):
        lines += [f"### {i + 1}. {b.get('bookName', '')}（{b.get('author', '')}）", ""]
        if not chapters:
            lines += ["（未能取得章节全文）", ""]
            continue
        for ch in chapters:
            if ch.get("locked"):
                lines += [f"#### {ch.get('title', '')}（付费章，未抓取）", ""]
                continue
            lines += [
                f"#### {ch.get('title', '')}（约{ch.get('word_number', 0)}字）",
                "",
                str(ch.get("content", "")),
                "",
            ]
    lines += [
        "## 套路归纳（待补）",
        "",
        "- [ ] 开头钩子：",
        "- [ ] 节奏与爽点分布：",
        "- [ ] 主角人设与金手指：",
        "- [ ] 章末悬念手法：",
        "",
    ]
    return "\n".join(lines)


def cmd_report(args) -> None:
    cats = fanqie.list_rank()
    cat_name = cats.get(f"/rank/{args.path}", "")
    books = fanqie.rank_books(args.path, limit=args.limit)
    picked = books[: args.books]
    golden: list[list[dict]] = []
    failures = 0
    for b in picked:
        first = str(b.get("firstChapterItemId") or "")
        try:
            golden.append(fanqie.golden_chapters(first, count=args.golden) if first else [])
        except Exception as exc:  # 单书失败不拖垮整份报告
            failures += 1
            golden.append([])
            print(f"[warn] golden chapters failed for {b.get('bookName', '?')}: {exc}", file=sys.stderr)
        time.sleep(0.5)  # 温和节流
    md = _report_markdown(args.path, cat_name, books, golden)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(md)
    else:
        print(md)
    _emit({
        "ok": True,
        "path": args.path,
        "category": cat_name,
        "books": len(books),
        "golden_books": len(picked),
        "golden_failures": failures,
        "out": args.out or "stdout",
        "chars": len(md),
    })


def main() -> int:
    ap = argparse.ArgumentParser(description="扫榜编排（番茄）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("categories")
    p.set_defaults(fn=cmd_categories)

    p = sub.add_parser("rank")
    p.add_argument("path")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(fn=cmd_rank)

    p = sub.add_parser("chapters")
    p.add_argument("item_id")
    p.add_argument("--count", type=int, default=3)
    p.set_defaults(fn=cmd_chapters)

    p = sub.add_parser("report")
    p.add_argument("path")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--books", type=int, default=5, help="为前几本书抓黄金三章")
    p.add_argument("--golden", type=int, default=3)
    p.add_argument("--out", default="")
    p.set_defaults(fn=cmd_report)

    args = ap.parse_args()
    try:
        args.fn(args)
        return 0
    except Exception as exc:
        _emit({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
