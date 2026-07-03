// 자가 업데이트 자가 점검 — 프레임워크 없이 node:assert. 네트워크 없이 fetch 를 스텁해
// latestRelease 의 '최신 정식 릴리스 선택'과 isUpdateAvailable 의 버전 비교를 검증한다.
//   실행: pnpm --filter @qualiflow/agent exec tsx src/self-update.selfcheck.ts
// 로직이 깨지면 assert 가 던진다(깨진 채로 "통과"하지 않게).

import assert from "node:assert/strict";

import { buildApplyBat, isUpdateAvailable, latestRelease } from "./self-update";

// 버전 비교 — 미배포(dev)는 항상 false, 낮은→높은만 true.
assert.equal(isUpdateAvailable("0.3.0", "0.3.1"), true, "패치 올라가면 업데이트 있음");
assert.equal(isUpdateAvailable("0.3.0", "1.0.0"), true, "메이저 올라가면 업데이트 있음");
assert.equal(isUpdateAvailable("0.3.0", "0.3.0"), false, "같은 버전은 업데이트 없음");
assert.equal(isUpdateAvailable("0.4.0", "0.3.9"), false, "설치가 최신보다 높으면 업데이트 없음");
assert.equal(isUpdateAvailable("dev", "0.3.0"), false, "dev(미배포)는 비교 안 함");
// ★두 자리 patch — 숫자 비교여야 통과(문자열 비교면 "0.3.11"<"0.3.2" 로 틀린다). 잔버전 테스트의 급소.
assert.equal(isUpdateAvailable("0.3.1", "0.3.11"), true, "0.3.11 > 0.3.1 (두 자리 patch)");
assert.equal(isUpdateAvailable("0.3.2", "0.3.11"), true, "0.3.11 > 0.3.2 (문자열 아닌 숫자 비교)");
assert.equal(isUpdateAvailable("0.3.11", "0.3.12"), true, "0.3.12 > 0.3.11 (연속 잔버전)");
assert.equal(isUpdateAvailable("0.3.12", "0.3.11"), false, "다운그레이드는 업데이트 아님");

// latestRelease — draft/prerelease/자산없음/구버전 태그를 걸러 '가장 높은 정식 버전'을 고른다.
const ASSET = process.platform === "win32" ? "qualiflow-agent-Windows.zip" : "qualiflow-agent-macOS.zip";
const dl = (tag: string) => `https://github.com/meowtivator/qualiflow/releases/download/${tag}/${ASSET}`;
globalThis.fetch = (async () =>
  ({
    ok: true,
    status: 200,
    url: "",
    json: async () => [
      { tag_name: "agent-v0.9.0", draft: true, prerelease: false, assets: [{ name: ASSET, browser_download_url: dl("agent-v0.9.0") }] },
      { tag_name: "agent-v0.8.0", draft: false, prerelease: true, assets: [{ name: ASSET, browser_download_url: dl("agent-v0.8.0") }] },
      { tag_name: "agent-v0.5.0", draft: false, prerelease: false, assets: [{ name: "other.zip", browser_download_url: "x" }] },
      { tag_name: "agent-v0.4.0", draft: false, prerelease: false, assets: [{ name: ASSET, browser_download_url: dl("agent-v0.4.0") }] },
      { tag_name: "agent-v0.3.0", draft: false, prerelease: false, assets: [{ name: ASSET, browser_download_url: dl("agent-v0.3.0") }] }
    ]
  }) as unknown as Response) as typeof fetch;

const latest = await latestRelease();
assert.ok(latest, "정식 릴리스가 있어야 한다");
assert.equal(latest.version, "0.4.0", "draft/prerelease/자산없음 제외 후 가장 높은 정식 = 0.4.0");
assert.ok(latest.url.startsWith("https://github.com/meowtivator/qualiflow/releases/download/"), "다운로드 URL 은 우리 릴리스 화이트리스트 접두사");

// Windows 무음 업데이터 배치 생성 — 경로 보간 + 필수 3동작(상주정지/xcopy/재시작)이 다 들어있는지.
//   실제 실행은 실제 Windows 에서만 검증되지만, 문자열이 조용히 깨지면(경로 누락·라인 삭제) 여기서 잡는다.
const bat = buildApplyBat("C:\\Temp\\qf update\\package"); // 공백 든 경로로 따옴표 처리도 함께 검증
assert.ok(bat.includes('xcopy "C:\\Temp\\qf update\\package\\*" "%LOCALAPPDATA%\\QualiFlow\\"'), "xcopy 가 보간된 packageDir→설치폴더로 복사해야 한다");
assert.equal((bat.match(/schtasks \/End/g) ?? []).length, 3, "상주 3개를 모두 정지해야 한다(파일락 해제)");
assert.equal((bat.match(/schtasks \/Run/g) ?? []).length, 3, "상주 3개를 모두 재시작해야 한다");
assert.ok(/ping 127\.0\.0\.1 -n \d+/.test(bat), "정지 후 핸들 해제 대기(ping)가 있어야 한다");
// 파일락 대비 재시도 루프: 락 미해제로 한 번 실패해도 부분 교체가 안 되게 xcopy 를 반복해야 한다.
assert.ok(bat.includes(":qf_copy") && bat.includes("goto qf_copy"), "xcopy 재시도 루프(라벨+goto)가 있어야 한다");
assert.ok(bat.includes("if not errorlevel 1 goto qf_copied"), "복사 성공(errorlevel 0) 시에만 재시작으로 넘어가야 한다");
assert.ok(/if %QF_TRY% geq \d+ goto qf_copied/.test(bat), "재시도 상한(초과 시 best-effort 재시작)이 있어야 한다");
assert.ok(bat.includes("\r\n") && bat.endsWith("\r\n"), "배치는 CRLF 줄바꿈이어야 한다(cmd.exe)");
// 관측성: 자동패치가 조용히 실패하지 않도록 모든 단계를 로그 파일에 남겨야 한다(사후 디버깅용).
assert.ok(bat.includes('self-update.log'), "단계 로그를 self-update.log 에 남겨야 한다");
assert.ok(/mkdir "%USERPROFILE%\\\.qualiflow\\logs"/.test(bat), "로그 폴더를 먼저 생성해야 한다");
// 배치 안전 회귀 가드: echo/rem 텍스트에 괄호가 들어가면 과거처럼 if 블록이 조기종료된다 → 괄호 금지.
assert.ok(!/^(echo|rem)\b.*[()]/m.test(bat), "echo/rem 줄에 괄호 '()' 가 없어야 한다(배치 조기종료 회귀 방지)");

console.log("✅ self-update.selfcheck 통과 — 최신:", latest.version, "· apply-update.bat 생성 OK");
