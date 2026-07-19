#!/bin/bash
# 修仙・问道 — Linux/WSL/macOS 启动脚本

echo "  ╔══════════════════════════╗"
echo "  ║     修 仙 ・ 问 道      ║"
echo "  ╚══════════════════════════╝"
echo ""

cd "$(dirname "$0")"

# 清理旧进程
lsof -ti:3456 2>/dev/null | xargs kill -9 2>/dev/null

export PYTHONIOENCODING=utf-8
echo "[启动] 正在开启修仙世界 → http://localhost:3456"
if [ -x .venv/Scripts/python.exe ]; then
    .venv/Scripts/python.exe server.py      # Windows venv (Git Bash)
elif [ -x .venv/bin/python ]; then
    .venv/bin/python server.py              # Linux/macOS venv
else
    python3 server.py
fi
