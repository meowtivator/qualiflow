// Windows 배포본 생성 — dist/package(런타임) + install.bat/uninstall.bat + README를 한 폴더로.
// ★맥에서 블라인드로 작성(텍스트). 실제 빌드/검증은 CI(windows-latest 러너)에서.
//   설치: %LOCALAPPDATA%\QualiFlow 로 복사 + 작업 스케줄러(로그온 시 run.cmd daemon) 등록.

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, "dist/win-dist");
const pkgSrc = resolve(here, "dist/package");
const TASK = "QualiFlow Agent";
const APP = "QualiFlow";
const CRLF = "\r\n";

console.log("① 런타임 패키지 빌드...");
execSync("node package-app.mjs", { cwd: here, stdio: "inherit" });

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });
cpSync(pkgSrc, resolve(distRoot, "package"), { recursive: true });

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
    `schtasks /Create /TN "${TASK}" /TR "\\"%DEST%\\run.cmd\\" daemon" /SC ONLOGON /F >nul`,
    `schtasks /Run /TN "${TASK}" >nul 2>&1`,
    "echo.",
    "echo 설치 완료 - 백그라운드에서 자동 동기화가 시작됩니다(로그인 시 자동 시작).",
    "echo 설치 위치: %DEST%",
    "echo 데이터:    %USERPROFILE%\\.qualiflow",
    'echo 채널 로그인: "%DEST%\\run.cmd" add alibaba main',
    "pause"
  ].join(CRLF) + CRLF
);

writeFileSync(
  resolve(distRoot, "uninstall.bat"),
  [
    "@echo off",
    `schtasks /Delete /TN "${TASK}" /F >nul 2>&1`,
    `rmdir /S /Q "%LOCALAPPDATA%\\${APP}"`,
    "echo 제거 완료. (로그인 세션 %USERPROFILE%\\.qualiflow 는 남겨둡니다)",
    "pause"
  ].join(CRLF) + CRLF
);

writeFileSync(
  resolve(distRoot, "README.txt"),
  [
    "QualiFlow 에이전트 - Windows 설치",
    "",
    "1) install.bat 더블클릭. SmartScreen이 막으면 '추가 정보' -> '실행'.",
    "   (또는 install.bat 우클릭 -> 속성 -> '차단 해제' 체크 -> 확인 후 실행.)",
    "2) 백그라운드에서 자동 동기화(로그인 시 자동 시작, 창 안 뜸).",
    '3) 채널 로그인(처음 한 번): "%LOCALAPPDATA%\\QualiFlow\\run.cmd" add alibaba main',
    "4) 제거: uninstall.bat.",
    "",
    "* 이 에이전트는 당신 PC에서만 돌고, 로그인 세션은 %USERPROFILE%\\.qualiflow 에 로컬 저장(서버로 안 감)."
  ].join(CRLF) + CRLF
);

console.log("✅ Windows 배포본 완성: apps/agent/dist/win-dist/  (CI(windows)에서 빌드/검증)");
