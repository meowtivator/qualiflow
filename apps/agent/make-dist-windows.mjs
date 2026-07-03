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

const DEST = `%LOCALAPPDATA%\\${APP}`;

// 상주 task 를 XML 로 등록한다(schtasks /Create /XML). 인라인 /Create 는 RestartOnFailure·
// ExecutionTimeLimit=무제한을 못 넣어서 (1)마법사가 죽으면 자동 재시작이 안 되고 (2)3일 뒤 중지될 수 있다.
// XML 이면 그 둘을 확실히 지정한다. 실행 명령은 기존과 동일: wscript run-hidden.vbs run.cmd <cmd>(창 숨김).
//
// ※ XML 에는 절대경로가 필요하고 env 확장이 신뢰 불가라, task.xml 을 "템플릿"으로 딱 하나만 배포하고
//   install.bat 이 설치 시점에 __DEST__/__USER__/__ARGS__ 를 실제값으로 치환해 task 마다 임시 XML 을 만든다.
//   (배치 echo 로 XML 을 직접 쓰면 < > & 이스케이프가 지옥이라, 파일 치환이 훨씬 안전하다.)
// - <ExecutionTimeLimit>PT0S</ExecutionTimeLimit> : 무제한(3일 후 중지 방지)
// - <RestartOnFailure> Interval PT1M / Count 3 : 죽으면 1분 뒤 재시작, 최대 3회
// - <LogonTrigger> + <LogonType>InteractiveToken</LogonType> : 로그인 세션에서 실행(크롬 로그인 창 때문에 필수)
// - <Hidden>true</Hidden>, <MultipleInstances>IgnoreNew</MultipleInstances>, 배터리에도 계속 실행
const TASK_XML_TEMPLATE = [
  '<?xml version="1.0" encoding="UTF-16"?>',
  '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
  "  <RegistrationInfo>",
  "    <Author>__USER__</Author>",
  "    <Description>QualiFlow resident agent</Description>",
  "  </RegistrationInfo>",
  "  <Triggers>",
  "    <LogonTrigger>",
  "      <Enabled>true</Enabled>",
  "      <UserId>__USER__</UserId>",
  "    </LogonTrigger>",
  "  </Triggers>",
  "  <Principals>",
  '    <Principal id="Author">',
  "      <UserId>__USER__</UserId>",
  "      <LogonType>InteractiveToken</LogonType>",
  "      <RunLevel>LeastPrivilege</RunLevel>",
  "    </Principal>",
  "  </Principals>",
  "  <Settings>",
  "    <MultipleInstances>IgnoreNew</MultipleInstances>",
  "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
  "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
  "    <AllowHardTerminate>true</AllowHardTerminate>",
  "    <StartWhenAvailable>true</StartWhenAvailable>",
  "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
  "    <IdleSettings>",
  "      <StopOnIdleEnd>false</StopOnIdleEnd>",
  "      <RestartOnIdle>false</RestartOnIdle>",
  "    </IdleSettings>",
  "    <AllowStartOnDemand>true</AllowStartOnDemand>",
  "    <Enabled>true</Enabled>",
  "    <Hidden>true</Hidden>",
  "    <RunOnlyIfIdle>false</RunOnlyIfIdle>",
  "    <WakeToRun>false</WakeToRun>",
  "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
  "    <Priority>7</Priority>",
  "    <RestartOnFailure>",
  "      <Interval>PT1M</Interval>",
  "      <Count>3</Count>",
  "    </RestartOnFailure>",
  "  </Settings>",
  '  <Actions Context="Author">',
  "    <Exec>",
  "      <Command>wscript</Command>",
  // 실행 명령: wscript "DEST\run-hidden.vbs" "DEST\run.cmd" <cmd>. XML 이라 따옴표는 &quot; 엔티티로.
  // install.bat 이 __DEST__(설치경로)·__CMD__(watch/serve/wizard) 를 치환한다.
  "      <Arguments>&quot;__DEST__\\run-hidden.vbs&quot; &quot;__DEST__\\run.cmd&quot; __CMD__</Arguments>",
  "    </Exec>",
  "  </Actions>",
  "</Task>"
].join(CRLF) + CRLF;

console.log("① 런타임 패키지 빌드...");
execSync("node package-app.mjs", { cwd: here, stdio: "inherit" });

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });
cpSync(pkgSrc, resolve(distRoot, "package"), { recursive: true });

// task 등록용 XML 템플릿을 배포 폴더에 둔다(ASCII). install.bat 이 이걸 읽어 __DEST__/__USER__/__CMD__ 만
// 치환하고 UTF-16 로 임시 XML 을 써서 schtasks /Create /XML 로 등록한다. 배포엔 이 원본 하나만 나간다.
// 빌드 시점 자가검사: 세 토큰이 다 있어야 install.bat 치환이 성립한다(템플릿을 잘못 편집하면 여기서 멈춘다).
for (const token of ["__DEST__", "__USER__", "__CMD__"]) {
  if (!TASK_XML_TEMPLATE.includes(token)) throw new Error(`task-template.xml 에 ${token} 토큰이 없습니다 — install.bat 치환이 깨집니다.`);
}
writeFileSync(resolve(distRoot, "task-template.xml"), TASK_XML_TEMPLATE);

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
    "rem The 3 tasks run run.cmd wrapped by run-hidden.vbs (window mode 0) so no black console appears on logon.",
    "rem Register each via XML (schtasks /Create /XML) so the task auto-restarts if it dies and never stops after 3 days.",
    "rem   watch  - periodically reads channel inboxes and pushes to cloud (live sync, auto-start on logon).",
    "rem   serve  - takes reply/send commands from the dashboard and sends them on the real channels.",
    "rem   wizard - keeps the setup UI (pairing + add channel) on localhost:4317. This is what web 'Add channel' opens.",
    "rem Build the per-task XML from task-template.xml: substitute install path, current user, and the sub-command,",
    "rem then write it as UTF-16 (schtasks /XML requires Unicode when the xml declares encoding UTF-16). PowerShell does",
    "rem both the substitution and the Unicode write, so we avoid escaping < > & inside batch echo.",
    'set "QF_TPL=%DEST%\\task-template.xml"',
    'set "QF_USER=%USERDOMAIN%\\%USERNAME%"',
    "call :qf_mktask watch  \"%TEMP%\\qf-watch.xml\"",
    `call :qf_regtask "${TASK_WATCH}"  "%TEMP%\\qf-watch.xml"`,
    "call :qf_mktask serve  \"%TEMP%\\qf-serve.xml\"",
    `call :qf_regtask "${TASK_SERVE}"  "%TEMP%\\qf-serve.xml"`,
    "call :qf_mktask wizard \"%TEMP%\\qf-wizard.xml\"",
    `call :qf_regtask "${TASK_WIZARD}" "%TEMP%\\qf-wizard.xml"`,
    `schtasks /Run /TN "${TASK_WATCH}" >nul 2>&1`,
    `schtasks /Run /TN "${TASK_SERVE}" >nul 2>&1`,
    `schtasks /Run /TN "${TASK_WIZARD}" >nul 2>&1`,
    "",
    "echo.",
    "echo Done. Background sync/send/wizard are registered (auto-start on login, auto-restart if they crash).",
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
    "  rem [Problem] Port 4317 never came up in 20s. Keep the window OPEN so the user sees this, and point them at the",
    "  rem wizard log (written by the wizard task) plus diagnose.bat. Do NOT auto-close here - the whole point is",
    "  rem that the user learns the install did NOT fully succeed instead of a cmd flashing shut.",
    "  echo.",
    "  echo [Problem] The wizard did not start within 20 seconds.",
    "  echo   See the log for the reason:",
    "  echo       %USERPROFILE%\\.qualiflow\\logs\\wizard.log",
    "  echo   To retry the wizard by hand, run:",
    '  echo       "%DEST%\\run.cmd" wizard',
    "  echo   Or double-click diagnose.bat (next to this installer) to check task status, port, and the log.",
    "  echo.",
    "  pause",
    ") else (",
    '  start "" "http://127.0.0.1:4317"',
    "  echo.",
    "  echo [OK] Setup complete. The wizard opened at http://127.0.0.1:4317",
    "  echo This window closes by itself - background sync/send/wizard keep running.",
    "  rem Success: install is done and the 3 tasks run independently under Task Scheduler,",
    "  rem so this window is safe to close. Auto-close after ~5s so no stray cmd lingers all day",
    "  rem (the reported 'cmd left on all day' was THIS install window sitting on pause).",
    "  rem Use ping (not timeout) to wait: timeout errors when stdin is redirected; ping never does.",
    "  ping -n 6 127.0.0.1 >nul",
    ")",
    "exit /b 0",
    "",
    "rem ---- subroutines (below the exit above; batch runs them only via call) ----",
    "rem :qf_mktask <sub-command> <out-xml-path>  - render task-template.xml -> UTF-16 xml for this task.",
    "rem   %~1 = watch|serve|wizard, %~2 = output xml path. Substitute install path, user, and sub-command,",
    "rem   then write UTF-16 (Unicode) so schtasks /XML accepts the UTF-16 declaration.",
    "rem   Use .Replace (plain string, no regex) so backslashes in the path stay literal - the tokens are unique",
    "rem   fixed strings, so no regex is needed. %DEST% is already an absolute path (LOCALAPPDATA expanded at set time).",
    ":qf_mktask",
    'powershell -NoProfile -Command "$t=Get-Content -Raw -LiteralPath $env:QF_TPL;$t=$t.Replace(\'__DEST__\',$env:DEST).Replace(\'__USER__\',$env:QF_USER).Replace(\'__CMD__\',\'%~1\');Set-Content -LiteralPath \'%~2\' -Value $t -Encoding Unicode -NoNewline"',
    "goto :eof",
    "",
    "rem :qf_regtask <task-name> <xml-path>  - register (overwrite) the task from its xml; report if it fails.",
    ":qf_regtask",
    'schtasks /Create /TN %1 /XML %2 /F >nul 2>&1',
    "if errorlevel 1 echo [Warning] Could not register task %1. Run diagnose.bat to see details.",
    "goto :eof"
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
    'if exist "%USERPROFILE%\\.qualiflow\\logs\\wizard.log" (',
    '  powershell -NoProfile -Command "Get-Content -LiteralPath \'%USERPROFILE%\\.qualiflow\\logs\\wizard.log\' -Tail 40"',
    ") else (",
    "  echo   (no log file yet - the wizard task has not written one)",
    ")",
    "echo.",
    "echo ==== end ====",
    "echo To retry the wizard by hand:",
    `echo     "%LOCALAPPDATA%\\${APP}\\run.cmd" wizard`,
    "pause"
  ].join(CRLF) + CRLF
);

console.log("✅ Windows 배포본 완성: apps/agent/dist/win-dist/  (CI(windows)에서 빌드/검증)");
