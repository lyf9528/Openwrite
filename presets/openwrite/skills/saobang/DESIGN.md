# 扫榜（saobang）功能设计笔记

> 状态：番茄数据通路已端到端打通（榜单 + 黄金三章全文解码）。UI/资料集成形态待定。

## 1. 已完成：番茄数据抓取

位置：`presets/openwrite/skills/saobang/scripts/`
- `fanqie.py`
  - `rank_books(category, limit=N)` → 榜单（bookName/author/abstract/firstChapterItemId 等，PUA 字体已解码）
  - `golden_chapters(firstChapterItemId, count=3)` → `[{title, content, need_pay, next_item_id}]`
- `font_shield.py`：字体混淆（awesome-font）PUA 解码器（PIL 光栅 + 归一化匹配 + 学习）

运行：`~/GenericAgent/.venv/bin/python`（依赖 Pillow / fontTools / brotli / numpy）
缓存：`~/.cache/saobang/`

实测：《宜修换嫁年羹尧》黄金三章全文解码连贯，5 书榜单 + 3 章约 47s；仅个别字误配（如 习字→习宇）。

### 已修复的三个坑（勿回退）
1. `embedded_json`：榜单页是**裸 JSON**，章节页 `chapterData` 是**JS 字符串转义的 JSON**；
   需依次尝试「直接解析 → JS 字符串解包 → 剥 `\"` 兜底」。
2. 番茄字体是 **CFF 轮廓但 sfntVersion 伪造成 `\x00\x01\x00\x00`**，必须用 fontTools 改 `sfntVersion='OTTO'` 另存 `.plain`，否则 FreeType/PIL 抛 `unknown file format`。
3. woff/woff2 需 fontTools 解包后才能给 PIL 用。

## 2. OpenWrite 架构（集成点）

- 工作区根：`~/book/oneBook`，作品：`data/novels/book1`（title：危机处理游戏）
- Studio 后端：python 运行时（managed runtime），本机 127.0.0.1:<随机端口>，需实例认证（token 由宿主注入，外部不可得）
- 面板 → 后端：host 侧代理 `/studio-panel/api`（`packages/openwrite-bridge/src/domain.ts` 注册，含读写白名单）
- 「资料」视图：`packages/studio-panel/src/client/LibraryView.tsx`（`view.library`），现有标签页：
  资产 assets / 大纲 outline / 图谱 graph / 研究 research / 搜索 search
- 相关工具：`novel_doc_read/write/create`（项目文档，路径相对作品数据根，如 `src/xxx.md`）、
  `novel_asset_*`、`novel_source_action`（风格/设定参考文本管线）、`novel_reference_library_action`
- 开发回路：`npm run build`（bridge + studio-panel + dsh-dog）→ `scripts/install.sh` 装进 dsh profile（`~/.dsh/profiles/web`，`patchReload: live`）

## 3. 待定：交付形态

- A. 「资料」视图新增「扫榜」标签页（前端面板 + 后端代理白名单/路由；需 build + 安装进 profile）
- B. 做成 Agent 技能（SKILL.md + 脚本），对话触发 → 生成《扫榜》报告文档写入作品
- C. 两者都做（先 B 后 A）

---

## 实施进度（2026-09-23）

### Phase B（技能）——已完成
- `scripts/saobang.py`：编排 CLI，子命令 categories / rank / chapters / report，stdout 输出 JSON 状态行，
  report 的 Markdown 写 `--out` 文件。端到端实测通过（5 书榜单 + 2 书黄金三章 ≈ 3.5 min，字形匹配 CPU 密集）。
- `SKILL.md`（user-invocable: true）+ `references/deps.md`。
- 专用解释器：`~/.cache/saobang/venv`（fonttools/brotli/pillow/numpy），与 OpenWrite 运行时 venv、Agent 私有 venv 解耦。
- 已同步到已安装 profile：`~/.dsh/profiles/web/node_modules/dsh-openwrite/presets/openwrite/skills/saobang`。
- 已知限制：个别字形误识别（如"因"→"囚"）；stdout 经 head 截断会在终端显示乱码（数据本身正常）。

### Phase A（资料视图"扫榜"标签）——进行中
方案定型：
- bridge（openwrite-bridge/src）新增 `saobang.ts`：spawn 专用 venv 跑 saobang.py；
  report 走异步 job（内存 Map），UI 轮询 `saobang/jobs/{id}`。
- domain.ts `createProxyHandler` 在 skills 拦截旁加 `saobang` 拦截（path 校验 `^[0-9_]+$`，limit≤30/books≤10/golden≤5，15min 超时杀进程）。
- 端点：GET saobang/categories · GET saobang/rank?path&limit · POST saobang/report→{job_id} · GET saobang/jobs/{id} · POST saobang/jobs/{id}/cancel。
- studio-panel：SaobangView.tsx + module.css；LibraryView 注册第 7 个标签（label 硬编码"扫榜"，同 SkillsView 先例）。
- v1 报告只在视图内展示 + 复制/下载 .md；**不**直连文档写入（文档变更走 document/change-plan 双段预览契约，
  存档报告交给对话内 saobang 技能走 novel_doc 工具链）。
