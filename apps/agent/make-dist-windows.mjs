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
// 인라인 /Create 로 등록된 task 에 재시작(3회·1분)·무제한 실행을 나중에 얹는 best-effort PowerShell 한 줄.
// try/catch 로 감싸 실패해도 설치가 안 깨진다(등록·실행이 우선, 재시작은 보너스). PowerShell 문자열은
// 작은따옴표라 배치 안에서 안전하고, task 이름에도 작은따옴표가 없어 이스케이프가 필요 없다.
function psSettings(taskName) {
  return (
    'powershell -NoProfile -Command "try{ ' +
    "$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries " +
    "-ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1); " +
    `Set-ScheduledTask -TaskName '${taskName}' -Settings $s | Out-Null ` +
    '}catch{}"'
  );
}
const DEST = `%LOCALAPPDATA%\\${APP}`;

// 설치 폴더에서 실행 중인 프로세스(주로 node.exe)를 표적 종료해 파일락을 푼다. schtasks /End 는 자식
// node.exe 를 놓칠 수 있어, 이게 없으면 재설치(install)·삭제(uninstall) 때 공유위반·액세스거부가 난다.
// ExecutablePath 로 설치 폴더만 필터 → 다른 Node 앱은 절대 안 건드린다(관리자로 실행되므로 CIM 조회 OK).
// ★-like 는 \ 를 리터럴로 본다(정규식 아님) → 실제 경로처럼 '\'는 하나여야 한다('\\'면 매치 0 = 종전 버그).
const killNodeInFolder =
  `powershell -NoProfile -Command "Get-CimInstance Win32_Process | ` +
  `Where-Object { $_.ExecutablePath -like '*\\${APP}\\*' } | ` +
  `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;

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
    "",
    "rem [Elevate] Task registration and %LOCALAPPDATA% copy need admin. Re-launch self as admin via UAC if not already.",
    "net session >nul 2>&1",
    "if %errorlevel% neq 0 (",
    "  echo Requesting administrator privileges...",
    "  powershell -NoProfile -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"",
    "  exit /b",
    ")",
    "",
    'set "HERE=%~dp0"',
    `set "DEST=${DEST}"`,
    "",
    "rem [Guard] Prevent running from inside the zip - package\\run.cmd must sit next to this .bat.",
    'if not exist "%HERE%package\\run.cmd" (',
    "  echo [Stop] It looks like install.bat is running from inside the zip.",
    "  echo   Use 'Extract All' on the zip first, then run install.bat from the extracted folder.",
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
    "rem [Kill] /End can leave a child node.exe holding node.exe/agent.mjs; kill only node from the install folder",
    "rem (filtered by ExecutablePath so other Node apps are never touched). Without this, reinstall hits a sharing",
    "rem violation and the retry loop fails - and the user re-runs install.bat, getting the UAC prompt every time.",
    killNodeInFolder,
    "rem A running task can still hold node.exe for a moment after /End, so xcopy hits a sharing violation.",
    "rem Wait for the handles to release, then retry the copy up to 10 times (~30s) before giving up.",
    "ping 127.0.0.1 -n 3 >nul",
    "set /a QF_TRY=0",
    ":qf_xcopy",
    'xcopy "%HERE%package\\*" "%DEST%\\" /E /I /Y >nul',
    "if not errorlevel 1 goto qf_copied",
    "set /a QF_TRY+=1",
    "if %QF_TRY% geq 10 goto qf_copyfail",
    "ping 127.0.0.1 -n 4 >nul",
    "goto qf_xcopy",
    ":qf_copyfail",
    "echo [Error] Files are in use (sharing violation). Close QualiFlow, or restart the PC, then run install.bat again.",
    "pause",
    "exit /b 1",
    ":qf_copied",
    "",
    "rem [Unblock/MOTW] A zip downloaded from the internet marks every file with Zone.Identifier (Mark of the Web),",
    "rem and xcopy preserves that mark on the copies. So the copied run-hidden.vbs/run.cmd/node.exe each pop an",
    "rem 'Open File - Security Warning' when a task runs them - and that can block the background wizard from starting.",
    "rem Strip the mark from the installed files - and the source too, in case xcopy kept the ADS - so tasks run clean.",
    "rem   >nul 2>&1: best-effort - if PowerShell is locked down this must never fail the install.",
    `powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%DEST%' -Recurse | Unblock-File" >nul 2>&1`,
    `powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%HERE%package' -Recurse | Unblock-File" >nul 2>&1`,
    "",
    "rem The 3 tasks run run.cmd wrapped by run-hidden.vbs (window mode 0) so no black console appears on logon.",
    "rem Register each inline with schtasks /Create /SC ONLOGON - the proven form that registered fine on the",
    "rem reference PC ('Ready'). (PR #88 switched to /Create /XML, which the real machine REJECTED so all 3 tasks",
    "rem never registered at all - inline is the reliable path; restart/unlimited settings are added best-effort below.)",
    "rem   watch  - periodically reads channel inboxes and pushes to cloud (live sync, auto-start on logon).",
    "rem   serve  - takes reply/send commands from the dashboard and sends them on the real channels.",
    "rem   wizard - keeps the setup UI (pairing + add channel) on localhost:4317. This is what web 'Add channel' opens.",
    `schtasks /Create /TN "${TASK_WATCH}"  /TR "${hiddenTR("%DEST%", "watch")}"  /SC ONLOGON /F >nul`,
    `schtasks /Create /TN "${TASK_SERVE}"  /TR "${hiddenTR("%DEST%", "serve")}"  /SC ONLOGON /F >nul`,
    `schtasks /Create /TN "${TASK_WIZARD}" /TR "${hiddenTR("%DEST%", "wizard")}" /SC ONLOGON /F >nul`,
    "",
    "rem Best-effort: layer on auto-restart (3x, 1 min apart) and no execution time limit (never stop after 3 days)",
    "rem via PowerShell Set-ScheduledTask. Inline /Create above cannot express these; this adds them after the fact.",
    "rem Wrapped in try/catch so a failure here NEVER breaks the install - registration and run come first, restart is a bonus.",
    psSettings(TASK_WATCH),
    psSettings(TASK_SERVE),
    psSettings(TASK_WIZARD),
    "",
    "rem Start all 3 now (do not wait for the next logon).",
    `schtasks /Run /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /Run /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /Run /TN "${TASK_WIZARD}" >nul 2>&1`,
    "",
    "rem [Verify registration] Inline /Create above is silent (>nul). If the wizard task did not actually register",
    "rem (e.g. a policy blocks Task Scheduler), fail loudly here instead of leaving the user with nothing running.",
    `schtasks /Query /TN "${TASK_WIZARD}" >nul 2>&1 || (echo [Error] Failed to register the background task. Try running install.bat as administrator, then retry. & pause & exit /b 1)`,
    "",
    "echo.",
    "echo Done. Background sync/send/wizard are registered (auto-start on login).",
    "echo Install location: %DEST%",
    "echo Data:             %USERPROFILE%\\.qualiflow   (login sessions stay on this PC)",
    "echo.",
    "echo Opening the setup wizard in your browser...",
    "echo (You can close this window - background sync keeps running. Later, the CRM web 'Add channel' button reopens it.)",
    "echo.",
    "rem Wait until the wizard (4317) actually responds, then open the browser. First run is slow (node cold start +",
    "rem antivirus scan) - on some PCs well over 20s, so we wait up to 60s (120 x 500ms) before falling back.",
    "echo Preparing the setup wizard (up to 60s)...",
    'powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect(\'127.0.0.1\',4317);$c.Close();exit 0}catch{Start-Sleep -Milliseconds 500}};exit 1"',
    "if errorlevel 1 (",
    "  rem Port 4317 not up within 60s. Usually still starting - slow disk or antivirus - not a hard failure,",
    "  rem so open the browser anyway and show a calm message instead of an alarming failed.",
    "  rem ★Keep echo/rem inside this if-block free of round brackets - a stray close-bracket ends the block early.",
    "  start \"\" \"http://127.0.0.1:4317\"",
    "  echo.",
    "  echo [Info] The setup wizard is taking a little longer than usual to start - antivirus or first run.",
    "  echo   It usually comes up within a minute. Your browser was opened to:",
    "  echo       http://127.0.0.1:4317     - if it says refused, wait a few seconds and refresh.",
    "  echo   Still nothing after a minute? Double-click diagnose.bat next to this installer - it shows",
    "  echo   the task status, the port, and the wizard log so we can see why.",
    "  echo.",
    "  pause",
    ") else (",
    '  start "" "http://127.0.0.1:4317"',
    "  echo.",
    "  echo [OK] Setup complete. The wizard opened at http://127.0.0.1:4317",
    "  echo This window closes by itself - background sync/send/wizard keep running.",
    "  rem Success: install is done and the 3 tasks run independently under Task Scheduler,",
    "  rem so this window is safe to close. Auto-close after ~5s so no stray cmd lingers all day",
    "  rem the reported 'cmd left on all day' was THIS install window sitting on pause.",
    "  rem Use ping (not timeout) to wait: timeout errors when stdin is redirected; ping never does.",
    "  ping -n 6 127.0.0.1 >nul",
    ")",
    "exit /b 0"
  ].join(CRLF) + CRLF
);

// 제거 스크립트 — 태스크 2개 삭제 + 설치 폴더 삭제(로그인 세션은 남김).
writeFileSync(
  resolve(distRoot, "uninstall.bat"),
  [
    "@echo off",
    "rem [Elevate] Deleting tasks and the install folder needs admin. Re-launch self as admin via UAC if not already.",
    "net session >nul 2>&1",
    "if %errorlevel% neq 0 (",
    "  echo Requesting administrator privileges...",
    "  powershell -NoProfile -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"",
    "  exit /b",
    ")",
    "rem Stop the tasks before deleting - if running, node.exe locks the folder and rmdir fails.",
    `schtasks /End /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /End /TN "${TASK_WIZARD}" >nul 2>&1`,
    "rem schtasks /End can miss child/leftover node.exe. Kill only node started from the QualiFlow folder.",
    "rem (taskkill /IM node.exe would kill unrelated node apps too - forbidden; always filter by ExecutablePath.)",
    "rem ★Fix: the old pattern double-escaped the backslash ('*\\\\QualiFlow\\\\*'), which -like never matched",
    "rem against real single-backslash paths - so node.exe was never killed and rmdir failed with Access denied.",
    killNodeInFolder,
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
    "   제거: uninstall.bat 더블클릭. (관리자 권한 승인창이 뜨면 '예'. 그래도 안 지워지면 PC 재시작 후 폴더 삭제)",
    "",
    "* 문제가 있을 때: diagnose.bat 더블클릭 -> 상주 task 상태 / 4317 포트 / node 실행여부 / 마법사 로그를 한 화면에 보여줍니다.",
    "* 이 에이전트는 당신 PC에서만 돌고, 로그인 세션은 %USERPROFILE%\\.qualiflow 에 로컬 저장(서버로 안 감)."
  ].join(CRLF) + CRLF
);

// 진단 도구 — 설치가 안 되거나 마법사가 안 뜰 때 더블클릭. 상태를 한 화면에 모아 보여준다(아무것도 바꾸지 않음).
writeFileSync(
  resolve(distRoot, "diagnose.bat"),
  [
    "@echo off",
    "rem QualiFlow diagnostics - read-only. Double-click when the wizard will not open or install seems stuck.",
    "echo ==== QualiFlow diagnostics ====",
    "echo.",
    "echo [1/4] Scheduled tasks (Status / Last Result should be Running / 0):",
    `schtasks /Query /TN "${TASK_WATCH}"  /V /FO LIST 2>nul || echo   (not registered) ${TASK_WATCH}`,
    `schtasks /Query /TN "${TASK_SERVE}"  /V /FO LIST 2>nul || echo   (not registered) ${TASK_SERVE}`,
    `schtasks /Query /TN "${TASK_WIZARD}" /V /FO LIST 2>nul || echo   (not registered) ${TASK_WIZARD}`,
    "echo.",
    "echo [2/4] Wizard port 4317 open? (True = wizard is up):",
    'powershell -NoProfile -Command "try{(Test-NetConnection 127.0.0.1 -Port 4317 -WarningAction SilentlyContinue).TcpTestSucceeded}catch{$false}"',
    "echo.",
    "echo [3/4] node processes running (Id / Path):",
    'powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Select-Object Id,Path | Format-Table -AutoSize | Out-String"',
    "echo.",
    "echo [4/4] Wizard log (last 40 lines) - %USERPROFILE%\\.qualiflow\\logs\\wizard.log:",
    "rem ★-Encoding UTF8: the log is UTF-8 - node writes Korean. Without it PowerShell reads it as the ANSI code page",
    "rem   and Korean shows as mojibake - the ????? the user sees when they 'type' the file in cmd. This makes it readable.",
    'if exist "%USERPROFILE%\\.qualiflow\\logs\\wizard.log" (',
    '  powershell -NoProfile -Command "Get-Content -LiteralPath \'%USERPROFILE%\\.qualiflow\\logs\\wizard.log\' -Encoding UTF8 -Tail 40"',
    ") else (",
    "  echo   no log file yet - the wizard task has not written one",
    ")",
    "echo.",
    "echo ==== end ====",
    "echo To retry the wizard by hand:",
    `echo     "%LOCALAPPDATA%\\${APP}\\run.cmd" wizard`,
    "pause"
  ].join(CRLF) + CRLF
);

console.log("✅ Windows 배포본 완성: apps/agent/dist/win-dist/  (CI(windows)에서 빌드/검증)");
