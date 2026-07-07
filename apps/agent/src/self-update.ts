// 자가 업데이트 — 최신 릴리스를 받아 이 OS용 설치본 zip 을 임시폴더에 풀고 검증한다.
//   - Windows: 검증된 새 package 로 상주를 무음 교체·재시작하는 업데이터를 띄운다(완전 자동).
//   - mac/linux: 설치 폴더를 열어 사용자가 install 파일을 직접 실행하게 한다(반자동, 기존 그대로).
// 재등록·재시작이 끝나면 상주 서비스가 새 버전으로 돈다.
//
// ★보안 경계(AGENTS.md 3항 · 이 파일이 다운로드+실행에 닿으므로 줄단위로):
//   - 대상 레포 고정: meowtivator/qualiflow 만. 릴리스 조회도 이 레포 API 만.
//   - 다운로드 URL 화이트리스트: https://github.com/meowtivator/qualiflow/releases/download/ 로 시작하는
//     https URL 만 받는다. 그 외(다른 호스트/http/리다이렉트 목적지)는 거부 → 임의 코드 다운로드 차단.
//   - 원자성: 임시폴더에 받아 풀고 '설치 파일이 실제로 있는지' 검증한 뒤에야 적용/오픈한다.
//     기존 설치본은 검증 전엔 건드리지 않는다 → 검증 실패면 아무것도 바꾸지 않고 중단.
//   - ★신뢰 앵커 불변: Windows 자동 적용도 다운로드된 install.bat 을 실행하지 않는다. 우리가 코드로
//     생성한 apply-update.bat 만 실행하고, 그 내용은 이 파일에 고정(검증된 package 를 복사·재시작만).
//     신뢰의 근거는 여전히 'HTTPS + 릴리스 URL 화이트리스트'뿐 — 받은 배치 파일을 신뢰하지 않는다.
//   - 명시 트리거로만: /api/self-update(버튼) 이 호출할 때만 동작. 자동/주기 실행 없음.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { AGENT_VERSION } from "./config";

const REPO = "meowtivator/qualiflow";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases`;
// 다운로드 URL 은 반드시 이 접두사로 시작해야 한다(우리 릴리스 자산만). 리다이렉트도 이 검사에 걸린다.
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
// 이 OS 의 설치본 zip 이름 + 압축 안에 들어있어야 하는 설치 파일(검증용).
const ASSET = process.platform === "win32"
  ? { zip: "qualiflow-agent-Windows.zip", installer: "install.bat" }
  : { zip: "qualiflow-agent-macOS.zip", installer: "install.command" };

type ReleaseAsset = { name: string; browser_download_url: string };
type Release = { tag_name: string; prerelease: boolean; draft: boolean; assets: ReleaseAsset[] };

// "agent-v0.3.0" → [0,3,0]. 태그 형식이 아니면 null(비교 불가 → 최신으로 안 침).
function parseVersion(tag: string): number[] | null {
  const m = /^agent-v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function cmpVersion(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// 최신 정식 릴리스(agent-vX.Y.Z, draft/prerelease 제외) 중 버전이 가장 높은 것. 없으면 null.
export async function latestRelease(): Promise<{ version: string; url: string } | null> {
  const res = await fetch(RELEASES_API, {
    headers: { accept: "application/vnd.github+json", "user-agent": "qualiflow-agent" }
  });
  if (!res.ok) throw new Error(`릴리스 조회 실패(HTTP ${res.status})`);
  const releases = (await res.json()) as Release[];
  let best: { version: number[]; tag: string; asset: ReleaseAsset } | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    const v = parseVersion(r.tag_name);
    if (!v) continue;
    const asset = r.assets.find((a) => a.name === ASSET.zip);
    if (!asset) continue;
    if (!best || cmpVersion(v, best.version) > 0) best = { version: v, tag: r.tag_name, asset };
  }
  if (!best) return null;
  return { version: best.tag.replace(/^agent-v/, ""), url: best.asset.browser_download_url };
}

function openFolder(path: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    // explorer/open/xdg-open 은 모두 PATH 로 해석 가능한 실행파일이라 shell 이 불필요하다.
    // (win32 에서 shell:true 로 explorer 를 돌리면 정상인데도 exit code 1 을 실패로 오인할 여지가 있어 뺀다.)
    spawn(cmd, [path], { stdio: "ignore", detached: true }).unref();
  } catch {
    // 폴더 열기 실패는 치명적 아님 — 경로는 응답으로 사용자에게 준다.
  }
}

// 임시폴더에 zip 을 받아 풀고, 설치 파일이 있는지 검증한 뒤:
//   - Windows: 검증된 package 로 상주를 무음 교체·재시작(완전 자동, applying:true).
//   - mac/linux: 설치 폴더를 연다(반자동, 기존 그대로, applying:false).
//   반환: 버전 + folder(항상 포함 — 자동 실패 시 웹이 수동 안내에 씀) + applying(자동 적용 시작 여부).
export async function performSelfUpdate(): Promise<{ version: string; folder: string; applying: boolean }> {
  const latest = await latestRelease();
  if (!latest) throw new Error("설치 가능한 최신 릴리스를 찾지 못했습니다.");
  // 화이트리스트: 우리 릴리스 자산 URL 만. (다른 호스트/http/오타 URL 차단)
  if (!latest.url.startsWith(DOWNLOAD_PREFIX)) {
    throw new Error("다운로드 주소가 허용 목록과 다릅니다 — 업데이트를 중단합니다.");
  }

  const work = await mkdtemp(join(tmpdir(), "qf-update-"));
  const zipPath = join(work, ASSET.zip);
  try {
    const res = await fetch(latest.url, { headers: { "user-agent": "qualiflow-agent" }, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`다운로드 실패(HTTP ${res.status})`);
    // ★리다이렉트 최종 목적지도 화이트리스트 검사(github.com/... 또는 자산 CDN objects.githubusercontent.com).
    const finalUrl = res.url || latest.url;
    if (!finalUrl.startsWith(DOWNLOAD_PREFIX) && !finalUrl.startsWith("https://objects.githubusercontent.com/")) {
      throw new Error("다운로드가 허용되지 않은 주소로 이동했습니다 — 업데이트를 중단합니다.");
    }
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(zipPath));

    // 압축 해제 — 새 의존성 없이 OS 기본 도구. macOS=ditto, Windows=PowerShell Expand-Archive.
    await unzip(zipPath, work);

    // 검증: 압축 안 어딘가에 이 OS 의 설치 파일이 있어야 한다(없으면 잘못된/손상된 zip → 중단).
    const installerDir = await findInstaller(work, ASSET.installer);
    if (!installerDir) throw new Error("설치 파일을 찾지 못했습니다 — 업데이트를 중단합니다(손상된 다운로드).");

    // Windows 는 무음 업데이터로 완전 자동 적용을 시도한다. 성공하면 applying:true.
    //   실패해도 폴더는 열어(폴백) 웹이 수동 안내할 수 있게 folder 를 항상 채운다.
    if (process.platform === "win32") {
      const started = await startWindowsApply(installerDir, work).catch(() => false);
      if (started) return { version: latest.version, folder: installerDir, applying: true };
    }

    openFolder(installerDir);
    return { version: latest.version, folder: installerDir, applying: false };
  } catch (error) {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  // 성공 시 work 는 남긴다 — 업데이터/사용자가 그 폴더의 package·설치 파일을 써야 하므로.
}

// Windows 무음 자동 적용 — install.bat 을 실행하지 않는다(그 안엔 pause·브라우저열기 같은 대화형 꼬리가
//   있어 무인 실행에 안 맞음). 대신 그 핵심(상주 정지 → 핸들 해제 대기 → 새 package 덮어쓰기 → 재시작)만
//   재현하는 최소 비대화형 apply-update.bat 를 임시폴더에 생성해 detached 로 띄운다.
//   이 배치는 자신을 띄운 wizard 가 schtasks /End 로 꺼져도 독립 생존해 교체를 끝내고 마법사를 되살린다.
//   ★신뢰 앵커: 실행하는 배치는 '우리가 만든 이 문자열'뿐. 다운로드된 install.bat 은 안 건드린다.
//   packageDir = 압축해제 결과에서 install.bat 이 있는 폴더의 하위 package(런타임 본체).
//   반환: 업데이터를 spawn 하는 데 성공했으면 true, 아니면 false(호출부가 openFolder 폴백).
async function startWindowsApply(installerDir: string, work: string): Promise<boolean> {
  const packageDir = join(installerDir, "package");
  // package 폴더가 없으면(예상 밖 zip 구조) 자동 적용을 포기하고 폴백.
  const entries = await readdir(packageDir).catch(() => null);
  if (!entries || entries.length === 0) return false;

  const bat = buildApplyBat(packageDir);
  const batPath = join(work, "apply-update.bat");
  await writeFile(batPath, bat, "utf8");

  // detached + stdio ignore + windowsHide + unref → 부모(wizard)가 죽어도 살아남아 교체를 완료한다.
  spawn("cmd", ["/c", batPath], { detached: true, windowsHide: true, stdio: "ignore" }).unref();
  return true;
}

// apply-update.bat 문자열 생성(순수 함수 — 셀프체크가 경로 보간·schtasks 3개·xcopy 라인을 검증).
//   packageDir 를 따옴표로 감싸 공백 경로도 안전하게. 대상은 %LOCALAPPDATA%\QualiFlow(install.bat 과 동일).
export function buildApplyBat(packageDir: string): string {
  const CRLF = "\r\n";
  // ★모든 단계를 로그 파일에 남긴다. 이 배치는 detached(stdio:ignore)로 상주가 꺼진 뒤 도는데,
  //   조용히 실패하면(xcopy 락 10회 초과·재시작 실패) 화면에도 stdout 에도 흔적이 안 남는다 →
  //   %USERPROFILE%\.qualiflow\logs\self-update.log 로 남겨 사후에 원인을 볼 수 있게 한다.
  //   ★배치 안전: echo/rem 텍스트에 괄호 '()' 를 넣지 않는다(과거 if 블록 조기종료 회귀). 리다이렉트
  //   앞에는 공백을 둔다(줄 끝 숫자+'>>' 가 파일핸들 리다이렉트로 오해되는 것 방지).
  const LOGDIR = "%USERPROFILE%\\.qualiflow\\logs";
  const LOG = `${LOGDIR}\\self-update.log`;
  return [
    "@echo off",
    "rem QualiFlow 무음 업데이터 — 상주 3개 정지 → 핸들 해제 대기 → 새 package 덮어쓰기 → 재시작.",
    "rem self-update.ts 가 검증된 다운로드에서만 생성한다. 대화형 install.bat 을 대체하지 않고 핵심만 재현.",
    `if not exist "${LOGDIR}" mkdir "${LOGDIR}"`,
    `echo ==== self-update %DATE% %TIME% ====  >>"${LOG}"`,
    `echo [1/3] stopping resident tasks  >>"${LOG}"`,
    `schtasks /End /TN "QualiFlow Agent"   >>"${LOG}" 2>&1`,
    `schtasks /End /TN "QualiFlow Serve"   >>"${LOG}" 2>&1`,
    `schtasks /End /TN "QualiFlow Wizard"  >>"${LOG}" 2>&1`,
    "rem 작업 정지만으로는 자식 node.exe 가 살아남아 파일락을 붙잡으면 xcopy 가 공유 위반으로 실패한다.",
    "rem   설치폴더 경로로 표적 종료 → 다른 Node 앱은 안 건드린다. 생성된 파일이라 PowerShell 사용이 안전.",
    `echo   killing leftover QualiFlow node.exe to free the file lock  >>"${LOG}"`,
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\\QualiFlow\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"  >>"${LOG}" 2>&1`,
    "ping 127.0.0.1 -n 3 >nul",
    "rem 상주가 잡고 있던 node.exe 핸들이 풀릴 때까지 xcopy 를 최대 10회, 약 30초 내에서 재시도한다.",
    "rem   한 번만 복사하면 락이 안 풀린 순간 일부 파일이 누락돼 부분 교체로 설치가 깨진다.",
    "rem   errorlevel 0 성공이면 즉시 재시작으로, 10회 실패면 best-effort 재시작으로 상주가 죽은 채 남지 않게.",
    `echo [2/3] copying new package, retry up to 10x if node.exe still locked  >>"${LOG}"`,
    "set /a QF_TRY=0",
    ":qf_copy",
    `xcopy "${packageDir}\\*" "%LOCALAPPDATA%\\QualiFlow\\" /E /I /Y  >>"${LOG}" 2>&1`,
    "if not errorlevel 1 goto qf_copied",
    "set /a QF_TRY+=1",
    `echo   xcopy attempt %QF_TRY% failed, waiting then retry  >>"${LOG}"`,
    "if %QF_TRY% geq 10 goto qf_copied",
    "ping 127.0.0.1 -n 4 >nul",
    "goto qf_copy",
    ":qf_copied",
    `echo [3/3] restarting resident tasks after %QF_TRY% retries  >>"${LOG}"`,
    `schtasks /Run /TN "QualiFlow Agent"   >>"${LOG}" 2>&1`,
    `schtasks /Run /TN "QualiFlow Serve"   >>"${LOG}" 2>&1`,
    `schtasks /Run /TN "QualiFlow Wizard"  >>"${LOG}" 2>&1`,
    `echo ==== self-update finished ====  >>"${LOG}"`
  ].join(CRLF) + CRLF;
}

function unzip(zip: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, args] =
      process.platform === "darwin"
        ? (["ditto", ["-x", "-k", zip, dest]] as const)
        : process.platform === "win32"
          ? (["powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`]] as const)
          : (["unzip", ["-o", zip, "-d", dest]] as const);
    const child = spawn(cmd, [...args], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`압축 해제 실패(code ${code})`))));
  });
}

// 압축 해제 결과에서 설치 파일이 든 폴더를 찾는다(zip 이 폴더로 감싸므로 1~2단계 탐색).
async function findInstaller(root: string, installer: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === installer)) return root;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = await findInstaller(join(root, e.name), installer);
    if (found) return found;
  }
  return null;
}

// 현재 버전 < 최신 이면 업데이트 있음. dev(미배포)면 비교 안 함(false).
export function isUpdateAvailable(current: string, latest: string): boolean {
  const c = parseVersion(`agent-v${current}`);
  const l = parseVersion(`agent-v${latest}`);
  if (!c || !l) return false;
  return cmpVersion(l, c) > 0;
}
