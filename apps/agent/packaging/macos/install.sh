#!/bin/bash
# QualiFlow 로컬 에이전트 — macOS 백그라운드 자동실행(launchd LaunchAgent) 설치.
#
# 무엇을 하나: 로그인 시 자동 시작 + 항상 켜져 있는(KeepAlive) 백그라운드 데몬으로 등록한다.
# 상주는 'cli.ts watch'를 실행 = 주기적 off-screen fetch + (페어링 시) 클라우드 push.
# ★이건 "내 맥에서 도는 dev 설치"다. 남에게 나눠줄 서명 우회 설치본(.dmg/.app)은 다음 단계.
#
# 사용: bash apps/agent/packaging/macos/install.sh
set -euo pipefail

LABEL="com.qualiflow.agent"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG="$HOME/Library/Logs/qualiflow-agent.log"

# 이 스크립트(.../apps/agent/packaging/macos/install.sh)에서 4단계 위가 레포 루트.
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

# launchd는 로그인 셸의 PATH가 없으므로, 지금 셸에서 node/pnpm 경로를 찾아 plist에 박아 넣는다.
NODE_BIN="$(command -v node || true)"
PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "$NODE_BIN" || -z "$PNPM_BIN" ]]; then
  echo "❌ node/pnpm를 찾지 못했습니다. 'node -v', 'pnpm -v'가 되는 셸에서 실행하세요." >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"
PNPM_DIR="$(dirname "$PNPM_BIN")"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PNPM_BIN}</string>
    <string>--filter</string>
    <string>@qualiflow/agent</string>
    <string>exec</string>
    <string>tsx</string>
    <string>src/cli.ts</string>
    <string>watch</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO_ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${PNPM_DIR}:${NODE_DIR}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✅ 설치 완료 — 백그라운드 데몬이 등록됐습니다."
echo "   레이블: ${LABEL}"
echo "   로그:   ${LOG}  (tail -f 로 확인)"
echo "   해제:   bash apps/agent/packaging/macos/uninstall.sh"
echo "   동기화 주기 조정: launchd plist의 환경변수 QUALIFLOW_SYNC_INTERVAL_MS (기본 30분)"
