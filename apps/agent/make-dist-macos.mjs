// macOS 배포본 생성 — dist/package(런타임) + 더블클릭 설치/제거 스크립트 + 안내를 한 폴더로 묶는다.
// 결과: apps/agent/dist/macos-dist/  (이 폴더를 zip해서 배포 → 받는 사람이 install.command 우클릭→열기)
//   설치: Application Support로 복사 + launchd 등록(watch/serve/wizard 상주) + macOS 격리 속성 해제(서명 우회).

import { execSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, "dist/macos-dist");
const pkgSrc = resolve(here, "dist/package");
const LABEL = "com.qualiflow.agent"; // watch(실시간 fetch→push) 상주
const SERVE_LABEL = "com.qualiflow.serve"; // serve(발송 명령 처리) 상주
const WIZARD_LABEL = "com.qualiflow.wizard"; // wizard(로컬 설정 UI) 상주 — 웹 "채널 추가"가 여는 localhost:4317
const APP_NAME = "QualiFlow";

console.log("① 런타임 패키지 빌드...");
execSync("node package-app.mjs", { cwd: here, stdio: "inherit" });

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });
cpSync(pkgSrc, resolve(distRoot, "package"), { recursive: true });

// 설치 스크립트 — Application Support 복사 + launchd 등록(watch+serve) + 격리 해제 + 설정 마법사 자동 실행.
writeFileSync(
  resolve(distRoot, "install.command"),
  `#!/bin/bash
# QualiFlow 에이전트 설치 — 우클릭 → "열기"로 실행(서명 없는 앱).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/${APP_NAME}"
PLIST_WATCH="$HOME/Library/LaunchAgents/${LABEL}.plist"
PLIST_SERVE="$HOME/Library/LaunchAgents/${SERVE_LABEL}.plist"
PLIST_WIZARD="$HOME/Library/LaunchAgents/${WIZARD_LABEL}.plist"
LOG="$HOME/Library/Logs/qualiflow-agent.log"
SERVE_LOG="$HOME/Library/Logs/qualiflow-serve.log"
WIZARD_LOG="$HOME/Library/Logs/qualiflow-wizard.log"

echo "QualiFlow 에이전트를 설치합니다..."
mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
# cp -R 은 com.apple.provenance 같은 보호 확장속성 복사에 막혀 "Operation not permitted"가 난다.
# macOS 전용 ditto 로 복사한다(확장속성/권한을 알맞게 처리).
ditto "$HERE/package" "$DEST"
chmod +x "$DEST/node" "$DEST/run.sh"
# 인터넷에서 받은 파일의 macOS 격리 속성 해제(= 서명 우회로 실행 허용)
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# 상주 1) watch — 채널 인박스를 주기적으로 읽어 클라우드로 올림(실시간 동기화). run.sh 가 클라우드
#   주소/주기를 세팅한다(설치본에 박힘).
cat > "$PLIST_WATCH" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>$DEST/run.sh</string><string>watch</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

# 상주 2) serve — 대시보드에서 보낸 답장(발송 명령)을 받아 실제 채널로 보냄.
cat > "$PLIST_SERVE" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVE_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>$DEST/run.sh</string><string>serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$SERVE_LOG</string>
  <key>StandardErrorPath</key><string>$SERVE_LOG</string>
</dict>
</plist>
PLISTEOF

# 상주 3) wizard — 설정 UI(계정 페어링 + 채널 추가)를 localhost:4317 에 '항상' 띄운다.
#   대표가 CRM 웹의 "채널 추가" 버튼을 누르면 이 로컬 마법사가 열린다(브라우저는 여기서 안 염).
cat > "$PLIST_WIZARD" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${WIZARD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>$DEST/run.sh</string><string>wizard</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$WIZARD_LOG</string>
  <key>StandardErrorPath</key><string>$WIZARD_LOG</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST_WATCH" 2>/dev/null || true
launchctl unload "$PLIST_SERVE" 2>/dev/null || true
launchctl unload "$PLIST_WIZARD" 2>/dev/null || true
launchctl load "$PLIST_WATCH"
launchctl load "$PLIST_SERVE"
launchctl load "$PLIST_WIZARD"

echo ""
echo "✅ 설치 완료 — 백그라운드 동기화·발송·설정 UI가 켜졌습니다(로그인 시 자동 시작)."
echo "   설치 위치: $DEST"
echo "   데이터:    $HOME/.qualiflow   (로그인 세션은 이 컴퓨터에만)"
echo ""
echo "이제 설정 마법사를 엽니다 — 브라우저에서 '코드 붙여넣기(페어링) + 채널 로그인'만 하면 끝입니다."
echo "(이 창을 닫아도 백그라운드 동기화는 계속됩니다. 나중엔 CRM 웹의 '채널 추가' 버튼으로도 열려요.)"
echo ""
# 마법사(4317)가 '실제로 응답할 때까지' 기다렸다 브라우저를 연다. 첫 실행은 node 콜드스타트로
# 2초보다 오래 걸려서, 고정 대기로는 '연결 거부'가 뜬다. 포트가 열리면 즉시 연다(최대 20초).
echo "설정 마법사를 준비하는 중입니다(최대 20초)..."
for _ in $(seq 1 40); do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:4317"; then break; fi
  sleep 0.5
done
open "http://127.0.0.1:4317" 2>/dev/null || true
`
);

// 제거 스크립트
writeFileSync(
  resolve(distRoot, "uninstall.command"),
  `#!/bin/bash
set -e
PLIST_WATCH="$HOME/Library/LaunchAgents/${LABEL}.plist"
PLIST_SERVE="$HOME/Library/LaunchAgents/${SERVE_LABEL}.plist"
PLIST_WIZARD="$HOME/Library/LaunchAgents/${WIZARD_LABEL}.plist"
launchctl unload "$PLIST_WATCH" 2>/dev/null || true
launchctl unload "$PLIST_SERVE" 2>/dev/null || true
launchctl unload "$PLIST_WIZARD" 2>/dev/null || true
rm -f "$PLIST_WATCH" "$PLIST_SERVE" "$PLIST_WIZARD"
rm -rf "$HOME/Library/Application Support/${APP_NAME}"
echo "🗑 제거 완료. (로그인 세션 ~/.qualiflow 는 남겨둡니다 — 지우려면 직접 삭제)"
echo "이 창은 닫아도 됩니다."
`
);

writeFileSync(
  resolve(distRoot, "README.txt"),
  `QualiFlow 에이전트 — macOS 설치 (터미널 없이 클릭만)

1) install.command 를 우클릭 → "열기" → 다시 "열기"
   (서명 없는 앱이라 그냥 더블클릭은 macOS가 막습니다. 우클릭→열기로 1회 허용.)
2) 설치가 끝나면 설정 마법사가 브라우저에 자동으로 뜹니다.
3) 마법사에서:
     ① 대시보드(crm.thedozers.com)의 "연결 소스 → 코드 발급"에서 코드를 받아 붙여넣기 → 페어링
     ② 연결할 채널 버튼을 눌러 로그인(알리바바=로그인창 / WhatsApp=QR / 텔레그램=전화코드)
4) 끝. 이후로는 백그라운드에서 자동으로 실시간 동기화 + 발송이 됩니다(로그인 시 자동 시작).
   ★ 나중에 채널을 더 추가할 때는, 브라우저를 켤 필요 없이 CRM 웹의 "연결 소스 → 채널 추가"
     버튼을 누르면 이 설정 마법사가 다시 열립니다(로컬에 항상 떠 있음).
   제거: uninstall.command 우클릭 → 열기.

* 이 에이전트는 당신 맥에서만 돌고, 로그인 세션은 ~/.qualiflow 에 로컬 저장됩니다(서버로 안 감).
`
);

for (const file of ["install.command", "uninstall.command"]) {
  chmodSync(resolve(distRoot, file), 0o755);
}

console.log("✅ macOS 배포본 완성: apps/agent/dist/macos-dist/");
console.log("   → 이 폴더를 zip해서 배포. 받는 사람은 install.command 우클릭→열기.");
