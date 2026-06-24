// macOS 배포본 생성 — dist/package(런타임) + 더블클릭 설치/제거 스크립트 + 안내를 한 폴더로 묶는다.
// 결과: apps/agent/dist/macos-dist/  (이 폴더를 zip해서 배포 → 받는 사람이 install.command 우클릭→열기)
//   설치: Application Support로 복사 + launchd 등록(run.sh daemon) + macOS 격리 속성 해제(서명 우회).

import { execSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, "dist/macos-dist");
const pkgSrc = resolve(here, "dist/package");
const LABEL = "com.qualiflow.agent";
const APP_NAME = "QualiFlow";

console.log("① 런타임 패키지 빌드...");
execSync("node package-app.mjs", { cwd: here, stdio: "inherit" });

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });
cpSync(pkgSrc, resolve(distRoot, "package"), { recursive: true });

// 설치 스크립트 — Application Support 복사 + launchd 등록 + 격리 해제.
writeFileSync(
  resolve(distRoot, "install.command"),
  `#!/bin/bash
# QualiFlow 에이전트 설치 — 우클릭 → "열기"로 실행(서명 없는 앱).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/${APP_NAME}"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG="$HOME/Library/Logs/qualiflow-agent.log"

echo "QualiFlow 에이전트를 설치합니다..."
mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
# cp -R 은 com.apple.provenance 같은 보호 확장속성 복사에 막혀 "Operation not permitted"가 난다.
# macOS 전용 ditto 로 복사한다(확장속성/권한을 알맞게 처리).
ditto "$HERE/package" "$DEST"
chmod +x "$DEST/node" "$DEST/run.sh"
# 인터넷에서 받은 파일의 macOS 격리 속성 해제(= 서명 우회로 실행 허용)
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DEST/run.sh</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo ""
echo "✅ 설치 완료 — 백그라운드에서 자동 동기화가 시작됩니다(로그인 시 자동 시작)."
echo "   설치 위치: $DEST"
echo "   데이터:    $HOME/.qualiflow   (로그인 세션은 로컬에만)"
echo "   로그:      $LOG"
echo ""
echo "▶ 채널 로그인(처음 한 번): \\"$DEST/run.sh\\" add alibaba main   (telegram/whatsapp/instagram 도)"
echo "이 창은 닫아도 됩니다."
`
);

// 제거 스크립트
writeFileSync(
  resolve(distRoot, "uninstall.command"),
  `#!/bin/bash
set -e
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$HOME/Library/Application Support/${APP_NAME}"
echo "🗑 제거 완료. (로그인 세션 ~/.qualiflow 는 남겨둡니다 — 지우려면 직접 삭제)"
echo "이 창은 닫아도 됩니다."
`
);

writeFileSync(
  resolve(distRoot, "README.txt"),
  `QualiFlow 에이전트 — macOS 설치

1) install.command 를 우클릭 → "열기" → 다시 "열기"
   (서명 없는 앱이라 그냥 더블클릭은 macOS가 막습니다. 우클릭→열기로 1회 허용.)
2) 설치되면 백그라운드에서 자동으로 동기화합니다(로그인 시 자동 시작, 창 안 뜸).
3) 채널 로그인(처음 한 번, 채널마다):
     ~/Library/Application\\ Support/${APP_NAME}/run.sh add alibaba main
4) 제거: uninstall.command 우클릭 → 열기.

* 이 에이전트는 당신 맥에서만 돌고, 로그인 세션은 ~/.qualiflow 에 로컬 저장됩니다(서버로 안 감).
`
);

for (const file of ["install.command", "uninstall.command"]) {
  chmodSync(resolve(distRoot, file), 0o755);
}

console.log("✅ macOS 배포본 완성: apps/agent/dist/macos-dist/");
console.log("   → 이 폴더를 zip해서 배포. 받는 사람은 install.command 우클릭→열기.");
