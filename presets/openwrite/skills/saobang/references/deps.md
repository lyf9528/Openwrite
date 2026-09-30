# 依赖与环境

脚本依赖（`font_shield.py` 懒加载）：`fontTools`、`brotli`、`Pillow`、`numpy`。

标准做法（已在本机执行过一次）：

```bash
python3 -m venv ~/.cache/saobang/venv
~/.cache/saobang/venv/bin/pip install fonttools brotli pillow numpy
```

运行一律用 `~/.cache/saobang/venv/bin/python`（不要用 OpenWrite 运行时 venv，那里没有 fontTools；
也不要依赖任何 Agent 私有环境）。

字形缓存（PUA→汉字映射、字体文件、已学模板）在 `~/.cache/saobang/`，删除后首次运行会重新学习（更慢）。
