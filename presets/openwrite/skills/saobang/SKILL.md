---
name: saobang
description: 扫榜——抓取番茄小说实时榜单与上榜作品"黄金三章"全文，生成扫榜报告文档，用于归纳开头写法套路。触发词："扫榜"、"榜单"、"黄金三章"、"番茄榜单"、"看看榜"。
user-invocable: true
---

# 扫榜

抓取番茄小说网实时榜单，解出上榜作品的黄金三章全文，生成《扫榜》报告文档，供归纳开头钩子、节奏与爽点套路。

## 脚本

位置：`presets/openwrite/skills/saobang/scripts/`，用专用 venv 运行（依赖见 references/deps.md）：

```bash
PY=~/.cache/saobang/venv/bin/python
cd presets/openwrite/skills/saobang/scripts   # 相对工作区，或绝对路径 ~/.dsh/profiles/web/node_modules/dsh-openwrite/presets/openwrite/skills/saobang/scripts
```

```bash
python saobang.py categories                      # 列出可用榜单（频道id → 名称）
python saobang.py rank <path> --limit 20          # 单榜单书籍列表（JSON）
python saobang.py chapters <first_item_id> --count 3
python saobang.py report <path> --limit 10 --books 5 --golden 3 --out report.md
```

`<path>` 形如 `1_1_1014`：`频道(0女频/1男频)_榜型(1热门/2新书)_分类id`，名称以 `categories` 输出为准。

## 流程

1. 用户只说"扫榜"时，先 `categories` 列出可选频道，请用户挑一个；用户已指定分类/频道则直接用。
2. `report` 生成 Markdown 报告：榜单概览表 + 前 N 本书的黄金三章全文。
   - `--books` 控制抓全文的本数（每本约 1.5–2 分钟，字体解码是 CPU 密集操作）；默认 5。
   - stdout 最后一行是 JSON 状态（ok/books/golden_failures/out），据此判断成败。
3. 把报告写入作品：用 `novel_doc_write` 写到 `src/research/扫榜-<分类名>-<日期>.md`
   （目录不存在时先用 `novel_doc_create` 或直接由 write 建路径；遵循宿主文档工具的既有约定）。
4. 用户要"归纳套路"时，基于报告的黄金三章填## 套路归纳一节（开头钩子/节奏爽点/人设立住/章末悬念），
   再用 `novel_doc_write` 更新同一份文档。

## 约束与已知限制

- 仅番茄（fanqienovel.com）；起点等其它平台适配器未实现。
- 榜单页/章节页有字体反爬（PUA 码点），脚本已用字形匹配解码；个别生僻字可能误识别
  （如"因"识别成"囚"），归纳时按上下文理解，不要照抄明显错别字进正文。
- 付费章（needPay=1）抓不到全文，报告中标注"付费章，未抓取"。
- 单次抓取对站点温和：`report` 内已带 0.5s 节流；不要并发多跑、不要短时间反复全量扫。
- 榜单数据是实时快照，报告头部已标注生成日期；引用时注明时效。
