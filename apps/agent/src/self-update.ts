// 자가 업데이트 — 최신 릴리스를 받아 이 OS용 설치본 zip 을 임시폴더에 풀고, 설치 폴더를 연다.
// 사용자가 그 폴더의 설치 파일(install.command/​install.bat)을 실행하면 상주 서비스가 새 버전으로
// 재등록·재시작된다. ★자동 실행이 아니라 "받아서 열어두기"까지(반자동) — 아래 보안 경계 참조.
//
// ★보안 경계(AGENTS.md 3항 · 이 파일이 다운로드+실행에 닿으므로 줄단위로):
//   - 대상 레포 고정: meowtivator/qualiflow 만. 릴리스 조회도 이 레포 API 만.
//   - 다운로드 URL 화이트리스트: https://github.com/meowtivator/qualiflow/releases/download/ 로 시작하는
//     https URL 만 받는다. 그 외(다른 호스트/http/리다이렉트 목적지)는 거부 → 임의 코드 다운로드 차단.
//   - 원자성: 임시폴더에 받아 풀고 '설치 파일이 실제로 있는지' 검증한 뒤에야 사용자에게 연다.
//     기존 설치본은 이 과정에서 건드리지 않는다(설치 파일을 사용자가 실행해야 교체됨) → 실패해도 롤백 불필요.
//   - 명시 트리거로만: /api/self-update(버튼) 이 호출할 때만 동작. 자동/주기 실행 없음.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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

// 임시폴더에 zip 을 받아 풀고, 설치 파일이 있는지 검증한 뒤 그 폴더를 연다.
//   반환: 사용자가 실행할 설치 파일이 든 폴더 경로 + 버전. (자동 실행하지 않는다.)
export async function performSelfUpdate(): Promise<{ version: string; folder: string }> {
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

    openFolder(installerDir);
    return { version: latest.version, folder: installerDir };
  } catch (error) {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  // 성공 시 work 는 남긴다 — 사용자가 그 폴더의 설치 파일을 실행해야 하므로.
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
