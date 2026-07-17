#!/bin/bash
# svenska-overlay スキル用: ffmpeg と日本語フォントを用意する。
# Claude Code on the web のセッションはコンテナが使い捨てなので毎回入れ直す。
set -euo pipefail

# リモート(web)セッションでのみ実行。ローカルでは何もしない。
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# 既に入っていれば何もしない(冪等)
if command -v ffmpeg >/dev/null 2>&1 && fc-list 2>/dev/null | grep -qi "Noto Sans CJK"; then
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ffmpeg fonts-noto-cjk
