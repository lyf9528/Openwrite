#!/usr/bin/env python3
"""字体混淆解码（番茄小说反爬）。

原理
----
番茄把正文/书单里的部分汉字写成 Unicode 私有区码点（PUA, U+E000–U+F8FF），
再用一个动态生成的子集字体把这些 PUA 码点渲染成正常字形。抓到的 HTML 里
因此是"乱码"，只有拿到字体才能还原。

字体文件里 glyph 名就是 PUA 的十进制码点（如 gid58344），没有任何语义信息，
但**字形轮廓**与源字体（字体 name 表自述为 SourceHanSansSC 的子集）一致。
因此用光栅化 + IoU 形状匹配，把 PUA 字形对回 GB2312 全字集即可还原。

用法
----
    dec = FontShield(weight="normal")        # 或 "bold"
    dec.learn(html_or_font_bytes)            # 学习页面用到的字体
    text = dec.decode(raw_text)              # 还原文本

依赖：Pillow / fontTools / brotli / numpy（见 references/deps.md）
"""

from __future__ import annotations

import io
import json
import os
import re
import urllib.request

PUA_RE = re.compile(r"[\ue000-\uf8ff]")

CACHE_DIR = os.path.expanduser(os.environ.get("SAOBANG_CACHE", "~/.cache/saobang"))

SOURCE_FONT_URLS = {
    # 与番茄混淆字体的设计同源（Source Han Sans CN）。按需下载并缓存。
    "normal": [
        "https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release/SubsetOTF/CN/SourceHanSansCN-Normal.otf",
        "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/SubsetOTF/CN/SourceHanSansCN-Normal.otf",
    ],
    "bold": [
        "https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release/SubsetOTF/CN/SourceHanSansCN-Bold.otf",
        "https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/SubsetOTF/CN/SourceHanSansCN-Bold.otf",
    ],
}

RENDER_SIZE = 48
GRID = 32
INK_THRESHOLD = 40
BIN_THRESHOLD = 100

_FONT_FACE_RE = re.compile(r"url\((['\"]?)([^)'\"]+)\1\)")


def _ensure_cache() -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return CACHE_DIR


def _download(urls, dest: str) -> str:
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        return dest
    last = None
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
            if len(data) < 1_000_000:
                raise ValueError(f"too small: {len(data)}")
            tmp = dest + ".part"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, dest)
            return dest
        except Exception as exc:  # noqa: BLE001
            last = exc
    raise RuntimeError(f"source font download failed: {last}")


def source_font_path(weight: str = "normal") -> str:
    """返回匹配用的源字体路径（自动下载缓存）。"""
    weight = weight if weight in SOURCE_FONT_URLS else "normal"
    dest = os.path.join(_ensure_cache(), f"SourceHanSansCN-{weight}.otf")
    return _download(SOURCE_FONT_URLS[weight], dest)


def gb2312_charset() -> list[str]:
    """GB2312 全字集（约 7445 字），覆盖绝大多数网络小说用字。"""
    chars: list[str] = []
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.append(bytes([hi, lo]).decode("gb2312"))
            except Exception:  # noqa: BLE001
                continue
    for hi in range(0xA1, 0xB0):  # 符号区
        for lo in range(0xA1, 0xFF):
            try:
                chars.append(bytes([hi, lo]).decode("gb2312"))
            except Exception:  # noqa: BLE001
                continue
    return chars


def _render(font_path: str, codepoint: int):
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(font_path, RENDER_SIZE)
    img = Image.new("L", (RENDER_SIZE * 2, RENDER_SIZE * 2), 0)
    ImageDraw.Draw(img).text((RENDER_SIZE // 2, RENDER_SIZE // 2), chr(codepoint), font=font, fill=255)
    return img


def _normalize(img):
    import numpy as np
    from PIL import Image

    arr = np.array(img)
    ys, xs = np.where(arr > INK_THRESHOLD)
    if len(xs) == 0:
        return None
    crop = arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape
    side = max(h, w)
    square = np.zeros((side, side), np.uint8)
    y0, x0 = (side - h) // 2, (side - w) // 2
    square[y0:y0 + h, x0:x0 + w] = crop
    small = Image.fromarray(square).resize((GRID, GRID), Image.LANCZOS)
    return (np.array(small) > BIN_THRESHOLD).astype(np.uint8)


class FontShield:
    """把一批 PUA 码点解码成真实汉字。"""

    def __init__(self, weight: str = "normal"):
        self.weight = weight if weight in SOURCE_FONT_URLS else "normal"
        self._cand_matrix = None
        self._cand_names: list[str] = []
        self._shields: list[str] = []   # 已学习的混淆字体文件路径
        self._pua: set[str] = set()
        self.mapping: dict[str, str] = {}
        self.confidence: dict[str, float] = {}

    # ---------- 学习字体 ----------

    def learn(self, blob, weight: str | None = None) -> bool:
        """blob 可以是 HTML 文本、字体 URL，或字体二进制。"""
        if weight:
            self.weight = weight
        saved = self._save_font_blob(blob)
        if not saved:
            return False
        if saved not in self._shields:
            self._shields.append(saved)
        self._pua |= self._pua_of(saved)
        return True

    def learn_from_html(self, html: str, base_url: str = "https://fanqienovel.com") -> bool:
        """从页面里提取 @font-face 的字体 URL 并下载学习（只取 woff2/otf 字体）。"""
        ok = False
        for _q, url in _FONT_FACE_RE.findall(html):
            if not url or "data:" in url[:8]:
                continue
            if not re.search(r"\.(woff2?|otf|ttf)(\?|$)", url):
                continue
            if url.startswith("//"):
                url = "https:" + url
            elif url.startswith("/"):
                url = base_url.rstrip("/") + url
            weight = "bold" if re.search(r"[-_.]?7\d\d\.(woff2?|otf|ttf)", url) else "normal"
            if self.learn(url, weight=weight):
                ok = True
        return ok

    def _save_font_blob(self, blob) -> str | None:
        _ensure_cache()
        if isinstance(blob, bytes):
            data = blob
            name = "inline"
        else:
            text = str(blob)
            if text.startswith("http://") or text.startswith("https://"):
                try:
                    req = urllib.request.Request(text, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=60) as resp:
                        data = resp.read()
                except Exception:  # noqa: BLE001
                    return None
                name = re.sub(r"[^0-9a-zA-Z]+", "_", text.rsplit("/", 1)[-1])[:80]
            elif text.lstrip().startswith("<"):
                return None
            else:
                return None
        path = os.path.join(CACHE_DIR, f"shield_{abs(hash(data)) % 10**12}_{name}")
        if not os.path.exists(path):
            with open(path, "wb") as fh:
                fh.write(data)
        return _ensure_ttf(path)

    def _pua_of(self, font_path: str) -> set[str]:
        from fontTools.ttLib import TTFont

        cmap = TTFont(font_path, fontNumber=0).getBestCmap()
        return {chr(cp) for cp in cmap if 0xE000 <= cp <= 0xF8FF}

    # ---------- 匹配 ----------

    def _candidates(self):
        import numpy as np

        if self._cand_matrix is not None:
            return self._cand_matrix, self._cand_names
        cache = os.path.join(_ensure_cache(), f"candvec_{self.weight}_{GRID}.npz")
        if os.path.exists(cache):
            blob = np.load(cache, allow_pickle=True)
            self._cand_matrix, self._cand_names = blob["m"], list(blob["n"])
            return self._cand_matrix, self._cand_names
        font_path = source_font_path(self.weight)
        names, vecs = [], []
        for ch in gb2312_charset():
            vec = _normalize(_render(font_path, ord(ch)))
            if vec is None:
                continue
            names.append(ch)
            vecs.append(vec.reshape(-1))
        self._cand_matrix = np.stack(vecs).astype(np.float32)
        self._cand_names = names
        try:
            np.savez_compressed(cache, m=self._cand_matrix, n=np.array(names, dtype=object))
        except Exception:  # noqa: BLE001
            pass
        return self._cand_matrix, self._cand_names

    def _match(self, codepoints: set[str]) -> None:
        import numpy as np

        matrix, names = self._candidates()
        sums = matrix.sum(1)
        for ch in codepoints:
            best, best_iou = None, -1.0
            for font_path in self._shields:
                vec = _normalize(_render(font_path, ord(ch)))
                if vec is None:
                    continue
                q = vec.reshape(-1).astype(np.float32)
                inter = matrix @ q
                iou = inter / np.maximum(sums + q.sum() - inter, 1.0)
                idx = int(iou.argmax())
                if float(iou[idx]) > best_iou:
                    best, best_iou = names[idx], float(iou[idx])
            if best is None:
                self.mapping[ch] = ch
                self.confidence[ch] = 0.0
            else:
                self.mapping[ch] = best
                self.confidence[ch] = best_iou

    def decode(self, text: str, threshold: float = 0.0) -> str:
        """还原文本中的 PUA 字符；threshold>0 时低置信字符保留原样。"""
        missing = {c for c in set(text) if PUA_RE.match(c)} - set(self.mapping)
        if missing:
            self._match(missing)
        out = []
        for ch in text:
            repl = self.mapping.get(ch)
            if repl is None or (threshold and self.confidence.get(ch, 0) < threshold):
                out.append(ch)
            else:
                out.append(repl)
        return "".join(out)

    # ---------- 持久化 ----------

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"weight": self.weight, "shields": self._shields, "mapping": self.mapping}, fh, ensure_ascii=False)

    def load(self, path: str) -> bool:
        if not os.path.exists(path):
            return False
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        self.weight = data.get("weight", self.weight)
        self._shields = data.get("shields", [])
        self.mapping.update(data.get("mapping", {}))
        return True


def decode_html_text(html: str, text: str, weight: str = "normal", threshold: float = 0.35) -> str:
    """一步式：学习页面字体并还原文本。"""
    shield = FontShield(weight=weight)
    shield.learn_from_html(html)
    return shield.decode(text, threshold=threshold)


def _ensure_ttf(path: str) -> str:
    """PIL 无法直接读 woff/woff2，用 fontTools 解压为纯 TTF/OTF（缓存同目录）。"""
    if path.endswith(".plain"):
        return path
    plain = path + ".plain"
    if os.path.exists(plain):
        return plain
    from fontTools.ttLib import TTFont

    font = TTFont(path, fontNumber=0)
    if getattr(font, "flavor", None):
        font.flavor = None
    # 番茄 awesome-font 的 sfntVersion 伪造为 \x00\x01\x00\x00 但实为 CFF 轮廓，
    # 必须改回 OTTO，否则 FreeType/PIL 拒绝加载。
    if "CFF " in font:
        font.sfntVersion = "OTTO"
    if getattr(font, "flavor", None) is None and "CFF " not in font:
        return path
    font.save(plain)
    return plain
