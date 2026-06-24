#!/bin/bash
# QualiFlow 로컬 에이전트 — macOS 백그라운드 자동실행 해제.
# 사용: bash apps/agent/packaging/macos/uninstall.sh
set -euo pipefail

LABEL="com.qualiflow.agent"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "🗑  해제 완료 — 백그라운드 데몬을 내렸습니다(${LABEL})."
echo "   세션/데이터(.auth, .data)는 그대로 둡니다. 지우려면 'remove <channel> <label>'로."
