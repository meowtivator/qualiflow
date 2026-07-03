// Windows 배포본 생성 — dist/package(런타임) + install.bat/uninstall.bat + README를 한 폴더로.
// ★맥에서 블라인드로 작성(텍스트). 실제 빌드/검증은 CI(windows-latest 러너)에서.
//   설치: %LOCALAPPDATA%\QualiFlow 로 복사 + 작업 스케줄러(로그온 시) 상주 세 개 등록:
//     - watch(실시간 fetch→클라우드 push, 인박스 최신화)
//     - serve(대시보드가 보낸 답장 발송)
//     - wizard(설정 UI 를 localhost:4317 에 항상 띄움 — 웹 "채널 추가" 버튼이 여는 화면)
//   설치 끝에 마법사(4317)가 실제로 응답할 때까지 기다렸다가 브라우저를 연다(첫 실행 콜드스타트 대비).

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, "dist/win-dist");
const pkgSrc = resolve(here, "dist/package");
const TASK_WATCH = "QualiFlow Agent"; // watch(실시간 fetch→push) 상주 — 기존 태스크명 유지(재설치 시 /F로 덮어씀)
const TASK_SERVE = "QualiFlow Serve"; // serve(발송 명령 처리) 상주
const TASK_WIZARD = "QualiFlow Wizard"; // wizard(로컬 설정 UI) 상주 — 웹 "채널 추가"가 여는 localhost:4317
const APP = "QualiFlow";
const CRLF = "\r\n";

console.log("① 런타임 패키지 빌드...");
execSync("node package-app.mjs", { cwd: here, stdio: "inherit" });

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });
cpSync(pkgSrc, resolve(distRoot, "package"), { recursive: true });

// 설치 스크립트 — %LOCALAPPDATA%\QualiFlow 복사 + 작업 스케줄러(watch+serve) 등록 + 설정 마법사 자동 실행.
// ※ 배치에서 다른 .cmd(run.cmd)를 호출할 땐 "call"을 붙인다 — 안 붙이면 제어가 넘어가고 안 돌아온다.
//   마지막 setup 마법사도 call 로 부른다(마법사가 끝나면 이 창의 안내가 이어지도록).
writeFileSync(
  resolve(distRoot, "install.bat"),
  [
    "@echo off",
    "setlocal",
    'set "HERE=%~dp0"',
    `set "DEST=%LOCALAPPDATA%\\${APP}"`,
    "echo QualiFlow 에이전트를 설치합니다...",
    'if not exist "%DEST%" mkdir "%DEST%"',
    'xcopy "%HERE%package\\*" "%DEST%\\" /E /I /Y >nul',
    "",
    "rem 상주 1) watch — 채널 인박스를 주기적으로 읽어 클라우드로 올림(실시간 동기화, 로그온 시 자동 시작).",
    `schtasks /Create /TN "${TASK_WATCH}" /TR "\\"%DEST%\\run.cmd\\" watch" /SC ONLOGON /F >nul`,
    "rem 상주 2) serve — 대시보드에서 보낸 답장(발송 명령)을 받아 실제 채널로 보냄.",
    `schtasks /Create /TN "${TASK_SERVE}" /TR "\\"%DEST%\\run.cmd\\" serve" /SC ONLOGON /F >nul`,
    "rem 상주 3) wizard — 설정 UI(계정 페어링 + 채널 추가)를 localhost:4317 에 항상 띄움. 웹 '채널 추가'가 여는 화면.",
    `schtasks /Create /TN "${TASK_WIZARD}" /TR "\\"%DEST%\\run.cmd\\" wizard" /SC ONLOGON /F >nul`,
    `schtasks /Run /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /Run /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /Run /TN "${TASK_WIZARD}" >nul 2>&1`,
    "",
    "echo.",
    "echo 설치 완료 - 백그라운드 동기화·발송·설정 UI가 켜졌습니다(로그인 시 자동 시작).",
    "echo 설치 위치: %DEST%",
    "echo 데이터:    %USERPROFILE%\\.qualiflow   (로그인 세션은 이 컴퓨터에만)",
    "echo.",
    "echo 이제 설정 마법사를 엽니다 - 브라우저에서 '코드 붙여넣기(페어링) + 채널 로그인'만 하면 끝입니다.",
    "echo (이 창을 닫아도 백그라운드 동기화는 계속됩니다. 나중엔 CRM 웹의 '채널 추가' 버튼으로도 열려요.)",
    "echo.",
    "rem 마법사(4317)가 '실제로 응답할 때까지' 기다렸다가 브라우저를 연다. 첫 실행은 node 콜드스타트+",
    "rem 백신 검사로 3초보다 오래 걸려서, 고정 대기로는 '연결 거부'가 떴다. 포트가 열리면 즉시 연다(최대 20초).",
    "echo 설정 마법사를 준비하는 중입니다(최대 20초)...",
    'powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect(\'127.0.0.1\',4317);$c.Close();exit 0}catch{Start-Sleep -Milliseconds 500}};exit 1"',
    "if errorlevel 1 (",
    "  echo.",
    "  echo [안내] 마법사가 20초 안에 준비되지 않았습니다.",
    "  echo   - 잠시 후 브라우저에서 http://127.0.0.1:4317 을 새로고침해 보세요.",
    "  echo   - 그래도 안 열리면 이 창에 아래 한 줄을 붙여넣어 원인을 확인하세요:",
    '  echo       "%DEST%\\run.cmd" wizard',
    ") else (",
    '  start "" "http://127.0.0.1:4317"',
    "  echo 설정 마법사를 브라우저에서 열었습니다.",
    ")",
    "pause"
  ].join(CRLF) + CRLF
);

// 제거 스크립트 — 태스크 2개 삭제 + 설치 폴더 삭제(로그인 세션은 남김).
writeFileSync(
  resolve(distRoot, "uninstall.bat"),
  [
    "@echo off",
    `schtasks /Delete /TN "${TASK_WATCH}" /F >nul 2>&1`,
    `schtasks /Delete /TN "${TASK_SERVE}" /F >nul 2>&1`,
    `schtasks /Delete /TN "${TASK_WIZARD}" /F >nul 2>&1`,
    `rmdir /S /Q "%LOCALAPPDATA%\\${APP}"`,
    "echo 제거 완료. (로그인 세션 %USERPROFILE%\\.qualiflow 는 남겨둡니다 - 지우려면 직접 삭제)",
    "echo 이 창은 닫아도 됩니다.",
    "pause"
  ].join(CRLF) + CRLF
);

writeFileSync(
  resolve(distRoot, "README.txt"),
  [
    "QualiFlow 에이전트 - Windows 설치 (터미널 없이 클릭만)",
    "",
    "1) install.bat 더블클릭.",
    "   SmartScreen이 막으면 '추가 정보' -> '실행'.",
    "   (또는 install.bat 우클릭 -> 속성 -> '차단 해제' 체크 -> 확인 후 실행.)",
    "2) 설치가 끝나면 설정 마법사가 브라우저에 자동으로 뜹니다.",
    "3) 마법사에서:",
    "     (1) 대시보드(crm.thedozers.com)의 '연결 소스 -> 코드 발급'에서 코드를 받아 붙여넣기 -> 페어링",
    "     (2) 연결할 채널 버튼을 눌러 로그인(알리바바=로그인창 / WhatsApp=QR / 텔레그램=전화코드)",
    "4) 끝. 이후로는 백그라운드에서 자동으로 실시간 동기화 + 발송이 됩니다(로그인 시 자동 시작).",
    "   * 나중에 채널을 더 추가할 때는, CRM 웹의 '연결 소스 -> 채널 추가' 버튼을 누르면",
    "     이 설정 마법사가 다시 열립니다(로컬에 항상 떠 있음).",
    "   제거: uninstall.bat 더블클릭.",
    "",
    "* 이 에이전트는 당신 PC에서만 돌고, 로그인 세션은 %USERPROFILE%\\.qualiflow 에 로컬 저장(서버로 안 감)."
  ].join(CRLF) + CRLF
);

console.log("✅ Windows 배포본 완성: apps/agent/dist/win-dist/  (CI(windows)에서 빌드/검증)");
