#!/bin/bash
# QualiFlow 로컬 에이전트 릴리스 — 한 명령으로 태그→CI빌드→검증→GitHub Release.
#
#   scripts/release-agent.sh 0.3.1
#
# 하는 일(실패하면 중단):
#   1) main 최신 커밋에 agent-v<버전> 태그 생성 + 푸시
#   2) 그 태그 ref 로 build-agent CI 실행(version 입력으로 버전 스탬프 결정적 주입)
#   3) CI 완료 후 mac/win 아티팩트 다운로드 + zip
#   4) ★검증: 번들 버전 스탬프가 <버전> 인지 확인(아니면 중단 — 잘못된 릴리스 방지)
#   5) GitHub Release 생성 + 두 zip 첨부
#
# 사전조건: gh 로그인(gh auth status), 레포 루트에서 실행, main 이 릴리스할 코드.
set -euo pipefail

VER="${1:-}"
if [ -z "$VER" ]; then echo "사용법: scripts/release-agent.sh <버전>  (예: 0.3.1)"; exit 1; fi
TAG="agent-v$VER"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▶ preflight) gh 권한 확인"
gh auth status >/dev/null 2>&1 || { echo "  ✗ gh 미로그인 — 'gh auth login' 후 다시 실행"; exit 1; }
if [ "$(gh api "repos/{owner}/{repo}" --jq '.permissions.push' 2>/dev/null)" != "true" ]; then
  echo "  ✗ 이 gh 계정에 릴리스/푸시 권한이 없습니다(push=false). 권한 있는 계정으로 'gh auth login' 하세요."
  echo "    (지난번 '권한 없음'이 이거였을 가능성 — 여기서 먼저 걸러집니다.)"; exit 1
fi

echo "▶ 0) main 최신화"; git checkout main; git pull
MAIN_SHA="$(git rev-parse main)"

echo "▶ 1) 태그 $TAG → main 최신($(git rev-parse --short main))"
if git rev-parse "$TAG" >/dev/null 2>&1 && [ "$(git rev-parse "$TAG")" = "$MAIN_SHA" ]; then
  echo "  태그가 이미 main 최신 — 재사용"
else
  # 태그가 없거나 옛 커밋을 가리키면 main 최신으로 (재)설정. 미완 릴리스가 있으면 함께 정리.
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "  ⚠ 태그가 옛 커밋을 가리킴 → main 최신으로 이동(스테일 릴리스 방지)"
    gh release delete "$TAG" --yes 2>/dev/null || true   # 미완/구 릴리스 정리
  fi
  git tag -f "$TAG" main
  git push -f origin "$TAG"
fi

echo "▶ 2) build-agent CI (version=$TAG 주입)"
gh workflow run build-agent.yml --ref "$TAG" --field version="$TAG"
# ★우리가 방금 띄운 workflow_dispatch 런을 정확히 잡는다. 태그 force-push 가 유발하는
#   push 런(version 입력 없음 → git describe 폴백 → Windows 에서 'dev')을 잡지 않도록
#   --event workflow_dispatch + --branch <tag> 로 좁힌다. (지난 실패의 원인이 이거였다.)
echo "  dispatch 런 등록 대기..."
RUN_ID=""
for _ in $(seq 1 20); do
  sleep 3
  RUN_ID=$(gh run list --workflow=build-agent.yml --event workflow_dispatch --branch "$TAG" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$RUN_ID" ] && break
done
[ -z "$RUN_ID" ] && { echo "  ✗ dispatch 런을 찾지 못함 — GitHub Actions 를 확인하세요"; exit 1; }
echo "  run $RUN_ID (workflow_dispatch, ref=$TAG) — 완료 대기(수 분)"; gh run watch "$RUN_ID" --exit-status

echo "▶ 3) 아티팩트 다운로드 + zip"
WORK=$(mktemp -d)
gh run download "$RUN_ID" -n qualiflow-agent-macOS   -D "$WORK/macos"
gh run download "$RUN_ID" -n qualiflow-agent-Windows -D "$WORK/win"

echo "▶ 4) 버전 스탬프 검증 (mac·win 둘 다)"
# run.cmd 의 맨값(set "QUALIFLOW_AGENT_VERSION=X.Y.Z")에서 버전 추출.
# ★run.sh 는 ${VAR:-X.Y.Z} 기본값문법이라 파싱이 애매 → 두 번들 공통인 run.cmd 로 확인.
# ★mac·win 둘 다 검사: 지난 실패 때 mac=0.3.1 인데 win='dev' 였음(잘못된 런) — 한쪽만 보면 못 잡는다.
stamp_of() { grep -rhoE 'QUALIFLOW_AGENT_VERSION=[0-9]+\.[0-9]+\.[0-9]+' "$1/package/run.cmd" 2>/dev/null | head -1 | cut -d= -f2; }
MAC_STAMP=$(stamp_of "$WORK/macos"); WIN_STAMP=$(stamp_of "$WORK/win")
if [ "$MAC_STAMP" != "$VER" ] || [ "$WIN_STAMP" != "$VER" ]; then
  echo "  ✗ 번들 버전 불일치 (mac='$MAC_STAMP', win='$WIN_STAMP', 기대 $VER) — 릴리스 중단."
  echo "    win 이 'dev'/빈값이면 version 입력 없는 런을 받은 것 → 재실행하면 dispatch 런을 잡습니다."; exit 1
fi
echo "  ✓ 번들 버전 = mac:$MAC_STAMP · win:$WIN_STAMP"
( cd "$WORK/macos" && zip -qr "$WORK/qualiflow-agent-macOS.zip" . )
( cd "$WORK/win"   && zip -qr "$WORK/qualiflow-agent-Windows.zip" . )

echo "▶ 5) GitHub Release 생성"
NOTES_FILE="$ROOT/scripts/release-notes-$VER.md"
if [ -f "$NOTES_FILE" ]; then NOTES_ARG=(--notes-file "$NOTES_FILE"); else NOTES_ARG=(--generate-notes); fi
gh release create "$TAG" --title "agent v$VER" "${NOTES_ARG[@]}" \
  "$WORK/qualiflow-agent-macOS.zip" "$WORK/qualiflow-agent-Windows.zip"

echo "✅ 릴리스 완료: $TAG  (gh release view $TAG --web)"
rm -rf "$WORK"
