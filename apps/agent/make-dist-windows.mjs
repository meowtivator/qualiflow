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
const BOM = "﻿"; // UTF-8 BOM — cmd.exe가 한글 안내를 chcp 65001과 함께 올바로 읽게(BOM 없으면 mojibake 위험).

// 상주 3개를 창 없이 실행하는 헬퍼: `wscript run-hidden.vbs run.cmd <cmd>`.
// run.cmd 를 직접 schtasks TR 로 걸면 로그온마다 검은 콘솔창이 뜬다 → VBS 로 감싸 창을 숨긴다.
function hiddenTR(dest, cmd) {
  // schtasks /TR 안의 따옴표는 \" 로 이스케이프. 최종 명령:
  //   wscript "%DEST%\run-hidden.vbs" "%DEST%\run.cmd" <cmd>
  return `wscript \\"${dest}\\run-hidden.vbs\\" \\"${dest}\\run.cmd\\" ${cmd}`;
}
const DEST = `%LOCALAPPDATA%\\${APP}`;

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
  BOM + [
    "@echo off",
    "chcp 65001 >nul",
    "setlocal",
    'set "HERE=%~dp0"',
    `set "DEST=${DEST}"`,
    "",
    "rem [가드] zip 안에서 바로 실행한 경우 방지 — package\\run.cmd 가 옆에 있어야 정상.",
    'if not exist "%HERE%package\\run.cmd" (',
    "  echo [중단] 설치 파일이 압축 안에 있는 것 같습니다.",
    "  echo   zip 을 먼저 '압축 풀기(모두 추출)' 한 뒤, 풀린 폴더에서 install.bat 을 실행하세요.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "echo QualiFlow 에이전트를 설치합니다...",
    'if not exist "%DEST%" mkdir "%DEST%"',
    "",
    "rem [파일락] 재설치/업데이트 시 실행 중인 상주가 node.exe·agent.mjs 를 잠가 xcopy 가 실패한다.",
    "rem 복사 전에 상주 3개를 멈추고 잠깐 대기(핸들 해제)한다. 첫 설치엔 태스크가 없어 무해(2>nul).",
    `schtasks /End /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_WIZARD}" >nul 2>&1`,
    "ping -n 3 127.0.0.1 >nul",
    "",
    'xcopy "%HERE%package\\*" "%DEST%\\" /E /I /Y >nul',
    "if errorlevel 1 (",
    "  echo [중단] 파일 복사에 실패했습니다.",
    "  echo   - 상주가 아직 파일을 쥐고 있을 수 있습니다. 이 창을 닫고 잠시 후 다시 실행해 보세요.",
    "  echo   - 또는 백신이 복사를 막았을 수 있습니다.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "rem 상주 3개는 run.cmd 를 run-hidden.vbs 로 감싸 창 없이(0) 실행한다 — 로그온 시 검은 콘솔창이 안 뜨게.",
    "rem 상주 1) watch — 채널 인박스를 주기적으로 읽어 클라우드로 올림(실시간 동기화, 로그온 시 자동 시작).",
    `schtasks /Create /TN "${TASK_WATCH}" /TR "${hiddenTR("%DEST%", "watch")}" /SC ONLOGON /F >nul`,
    "rem 상주 2) serve — 대시보드에서 보낸 답장(발송 명령)을 받아 실제 채널로 보냄.",
    `schtasks /Create /TN "${TASK_SERVE}" /TR "${hiddenTR("%DEST%", "serve")}" /SC ONLOGON /F >nul`,
    "rem 상주 3) wizard — 설정 UI(계정 페어링 + 채널 추가)를 localhost:4317 에 항상 띄움. 웹 '채널 추가'가 여는 화면.",
    `schtasks /Create /TN "${TASK_WIZARD}" /TR "${hiddenTR("%DEST%", "wizard")}" /SC ONLOGON /F >nul`,
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
  BOM + [
    "@echo off",
    "chcp 65001 >nul",
    "rem 삭제 전에 상주를 멈춘다 — 실행 중이면 node.exe 가 폴더를 잠가 rmdir 가 실패한다.",
    `schtasks /End /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_WIZARD}" >nul 2>&1`,
    "rem schtasks /End 는 자식/잔여 node.exe 를 놓칠 수 있다. QualiFlow 폴더에서 뜬 node 만 정확히 종료한다.",
    "rem (taskkill /IM node.exe 는 무관한 다른 node 앱까지 죽이므로 금지 — 반드시 ExecutablePath 필터.)",
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\\\\${APP}\\\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
    "ping -n 3 127.0.0.1 >nul",
    `schtasks /Delete /TN "${TASK_WATCH}" /F >nul 2>&1`,
    `schtasks /Delete /TN "${TASK_SERVE}" /F >nul 2>&1`,
    `schtasks /Delete /TN "${TASK_WIZARD}" /F >nul 2>&1`,
    "rem 폴더 삭제 — 아직 파일을 쥔 핸들이 남아 있으면 rmdir 가 '액세스 거부'로 실패한다.",
    "rem 핸들이 풀릴 때까지 최대 5회(각 사이 2초 대기) 재시도한다.",
    "set /a UTRY=0",
    ":qf_udel",
    `rmdir /S /Q "%LOCALAPPDATA%\\${APP}"`,
    `if not exist "%LOCALAPPDATA%\\${APP}" goto qf_udone`,
    "set /a UTRY+=1",
    "if %UTRY% geq 5 goto qf_ufail",
    "ping -n 3 127.0.0.1 >nul",
    "goto qf_udel",
    ":qf_udone",
    "echo 제거 완료. (로그인 세션 %USERPROFILE%\\.qualiflow 는 남겨둡니다 - 지우려면 직접 삭제)",
    "goto qf_uend",
    ":qf_ufail",
    "echo [안내] 일부 파일이 사용 중이라 폴더를 완전히 지우지 못했습니다.",
    `echo   PC를 재시작한 뒤 이 폴더를 직접 삭제하세요: %LOCALAPPDATA%\\${APP}`,
    ":qf_uend",
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
    "   제거: uninstall.bat 더블클릭. (관리자 권한 불필요 - 개인 폴더 설치라. 그래도 안 지워지면 PC 재시작 후 폴더 삭제)",
    "",
    "* 이 에이전트는 당신 PC에서만 돌고, 로그인 세션은 %USERPROFILE%\\.qualiflow 에 로컬 저장(서버로 안 감)."
  ].join(CRLF) + CRLF
);

console.log("✅ Windows 배포본 완성: apps/agent/dist/win-dist/  (CI(windows)에서 빌드/검증)");
