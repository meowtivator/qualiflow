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

echo "▶ 0) main 최신화"; git checkout main; git pull

echo "▶ 1) 태그 $TAG"
if git rev-parse "$TAG" >/dev/null 2>&1; then echo "  이미 있음 — 재사용"; else git tag "$TAG" main; git push origin "$TAG"; fi

echo "▶ 2) build-agent CI (version=$TAG 주입)"
gh workflow run build-agent.yml --ref "$TAG" --field version="$TAG"
sleep 5
RUN_ID=$(gh run list --workflow=build-agent.yml --limit 1 --json databaseId --jq '.[0].databaseId')
echo "  run $RUN_ID — 완료 대기(수 분)"; gh run watch "$RUN_ID" --exit-status

echo "▶ 3) 아티팩트 다운로드 + zip"
WORK=$(mktemp -d)
gh run download "$RUN_ID" -n qualiflow-agent-macOS   -D "$WORK/macos"
gh run download "$RUN_ID" -n qualiflow-agent-Windows -D "$WORK/win"

echo "▶ 4) 버전 스탬프 검증"
STAMP=$(grep -rho "QUALIFLOW_AGENT_VERSION=[0-9.]*" "$WORK/macos" | head -1 | cut -d= -f2 || true)
if [ "$STAMP" != "$VER" ]; then
  echo "  ✗ 번들 버전 '$STAMP' (기대 $VER) — 릴리스 중단."; exit 1
fi
echo "  ✓ 번들 버전 = $STAMP"
( cd "$WORK/macos" && zip -qr "$WORK/qualiflow-agent-macOS.zip" . )
( cd "$WORK/win"   && zip -qr "$WORK/qualiflow-agent-Windows.zip" . )

echo "▶ 5) GitHub Release 생성"
NOTES_FILE="$ROOT/scripts/release-notes-$VER.md"
if [ -f "$NOTES_FILE" ]; then NOTES_ARG=(--notes-file "$NOTES_FILE"); else NOTES_ARG=(--generate-notes); fi
gh release create "$TAG" --title "agent v$VER" "${NOTES_ARG[@]}" \
  "$WORK/qualiflow-agent-macOS.zip" "$WORK/qualiflow-agent-Windows.zip"

echo "✅ 릴리스 완료: $TAG  (gh release view $TAG --web)"
rm -rf "$WORK"
