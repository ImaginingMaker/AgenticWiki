#!/bin/sh
# AgenticWiki — 全局安装
# 将 skills 复制到 ~/.agents/skills/，并替换脚本路径为绝对路径
# 安装后可在任意项目目录的 Agent 会话中直接使用

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_SRC="$SCRIPT_DIR/skills"
SKILLS_DST="$HOME/.agents/skills"

echo "📦 AgenticWiki Setup"
echo "   安装路径: $SCRIPT_DIR"
echo "   目标:     $SKILLS_DST"
echo ""

# 安装 skills
for skill_dir in "$SKILLS_SRC"/aw-*; do
  skill_name=$(basename "$skill_dir")
  dst="$SKILLS_DST/$skill_name"
  mkdir -p "$dst"

  # 复制并替换路径：相对路径 → 绝对路径
  sed "s|npx tsx src/lib/|npx tsx $SCRIPT_DIR/src/lib/|g" \
    "$skill_dir/SKILL.md" > "$dst/SKILL.md"

  echo "   ✅ $skill_name"
done

echo ""
echo "🎉 安装完成！现在在任意 Agent 会话中只需粘贴："
echo ""
echo "   你是 AgenticWiki 编排器，请加载 aw-orchestrator 分析 /path/to/project"
