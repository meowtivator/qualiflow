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
// ★배치의 사용자 노출 텍스트는 전부 ASCII(영문)로 쓴다 → cmd 코드페이지에 의존하지 않아 절대 안 깨진다.
//   그래서 chcp 65001 과 UTF-8 BOM 을 뺐다(둘 다 실기기에서 오히려 한글을 깨뜨렸다). 한글 안내는 README.txt(메모장)에만.

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
  [
    "@echo off",
    "setlocal",
    'set "HERE=%~dp0"',
    `set "DEST=${DEST}"`,
    "",
    "rem [Guard] Prevent running from inside the zip - package\\run.cmd must sit next to this .bat.",
    'if not exist "%HERE%package\\run.cmd" (',
    "  echo [Stop] It looks like install.bat is running from inside the zip.",
    "  echo   Extract the zip first (Extract All), then run install.bat from the extracted folder.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "echo Installing QualiFlow agent...",
    'if not exist "%DEST%" mkdir "%DEST%"',
    "",
    "rem [File lock] On reinstall/update a running task locks node.exe/agent.mjs so xcopy fails.",
    "rem Stop the 3 tasks and wait briefly (release handles) before copying. First install has no tasks, so harmless (2>nul).",
    `schtasks /End /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_WIZARD}" >nul 2>&1`,
    "ping -n 3 127.0.0.1 >nul",
    "",
    'xcopy "%HERE%package\\*" "%DEST%\\" /E /I /Y >nul',
    "if errorlevel 1 (",
    "  echo [Stop] Failed to copy files.",
    "  echo   - A background task may still be holding the files. Close this window and try again in a moment.",
    "  echo   - Or antivirus may have blocked the copy.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "rem The 3 tasks run run.cmd wrapped by run-hidden.vbs (window mode 0) so no black console appears on logon.",
    "rem Task 1) watch - periodically reads channel inboxes and pushes to cloud (live sync, auto-start on logon).",
    `schtasks /Create /TN "${TASK_WATCH}" /TR "${hiddenTR("%DEST%", "watch")}" /SC ONLOGON /F >nul`,
    "rem Task 2) serve - takes reply/send commands from the dashboard and sends them on the real channels.",
    `schtasks /Create /TN "${TASK_SERVE}" /TR "${hiddenTR("%DEST%", "serve")}" /SC ONLOGON /F >nul`,
    "rem Task 3) wizard - keeps the setup UI (pairing + add channel) on localhost:4317. This is what web 'Add channel' opens.",
    `schtasks /Create /TN "${TASK_WIZARD}" /TR "${hiddenTR("%DEST%", "wizard")}" /SC ONLOGON /F >nul`,
    `schtasks /Run /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /Run /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /Run /TN "${TASK_WIZARD}" >nul 2>&1`,
    "",
    "echo.",
    "echo Done. Background sync/send/wizard are running (auto-start on login).",
    "echo Install location: %DEST%",
    "echo Data:             %USERPROFILE%\\.qualiflow   (login sessions stay on this PC)",
    "echo.",
    "echo Opening the setup wizard in your browser...",
    "echo (You can close this window - background sync keeps running. Later, the CRM web 'Add channel' button reopens it.)",
    "echo.",
    "rem Wait until the wizard (4317) actually responds, then open the browser. First run is slower than 3s",
    "rem (node cold start + antivirus scan), so a fixed wait gave 'connection refused'. Open as soon as the port is up (max 20s).",
    "echo Preparing the setup wizard (up to 20s)...",
    'powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect(\'127.0.0.1\',4317);$c.Close();exit 0}catch{Start-Sleep -Milliseconds 500}};exit 1"',
    "if errorlevel 1 (",
    "  echo.",
    "  echo [Note] Wizard not ready yet.",
    "  echo   - Open http://127.0.0.1:4317 in your browser, or run:",
    '  echo       "%DEST%\\run.cmd" wizard',
    "  rem Keep the window open so the user can read the manual-open steps above.",
    "  pause",
    ") else (",
    '  start "" "http://127.0.0.1:4317"',
    "  echo Opened the setup wizard in your browser.",
    "  echo This window closes by itself - background sync/send/wizard keep running.",
    "  rem Success: install is done and the 3 tasks run independently under Task Scheduler,",
    "  rem so this window is safe to close. Auto-close after 5s so no stray cmd lingers all day",
    "  rem (the reported 'cmd left on all day' was THIS install window sitting on pause).",
    "  timeout /t 5 /nobreak >nul",
    ")"
  ].join(CRLF) + CRLF
);

// 제거 스크립트 — 태스크 2개 삭제 + 설치 폴더 삭제(로그인 세션은 남김).
writeFileSync(
  resolve(distRoot, "uninstall.bat"),
  [
    "@echo off",
    "rem Stop the tasks before deleting - if running, node.exe locks the folder and rmdir fails.",
    `schtasks /End /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_WIZARD}" >nul 2>&1`,
    "rem schtasks /End can miss child/leftover node.exe. Kill only node started from the QualiFlow folder.",
    "rem (taskkill /IM node.exe would kill unrelated node apps too - forbidden; always filter by ExecutablePath.)",
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\\\\${APP}\\\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
    "ping -n 3 127.0.0.1 >nul",
    `schtasks /Delete /TN "${TASK_WATCH}" /F >nul 2>&1`,
    `schtasks /Delete /TN "${TASK_SERVE}" /F >nul 2>&1`,
    `schtasks /Delete /TN "${TASK_WIZARD}" /F >nul 2>&1`,
    "rem Delete the folder - if a handle still holds a file, rmdir fails with 'Access denied'.",
    "rem Retry up to 5 times (2s wait between) until handles are released.",
    "set /a UTRY=0",
    ":qf_udel",
    `rmdir /S /Q "%LOCALAPPDATA%\\${APP}"`,
    `if not exist "%LOCALAPPDATA%\\${APP}" goto qf_udone`,
    "set /a UTRY+=1",
    "if %UTRY% geq 5 goto qf_ufail",
    "ping -n 3 127.0.0.1 >nul",
    "goto qf_udel",
    ":qf_udone",
    "echo Uninstall complete. (Login sessions in %USERPROFILE%\\.qualiflow are kept.)",
    "goto qf_uend",
    ":qf_ufail",
    `echo [Note] Some files were in use. Restart the PC and delete this folder manually: %LOCALAPPDATA%\\${APP}`,
    ":qf_uend",
    "echo You can close this window.",
    "pause"
  ].join(CRLF) + CRLF
);

writeFileSync(
  resolve(distRoot, "README.txt"),
  [
    "(한글이 깨져 보이면 이 파일을 메모장으로 여세요.)",
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
