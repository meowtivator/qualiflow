// Node 전용 런타임 진입점 — Playwright/CDP/child_process를 쓰는 알리바바 함수들을 모아 export한다.
// ★index.ts(순수: 브라우저/서버 번들 가능)와 분리한다. 웹앱은 index만 import하므로 Playwright가
//   웹 번들로 새지 않는다. 로컬 에이전트(Node)만 이 runtime 진입점을 import해 함수로 직접 호출한다.
//   (예전엔 에이전트가 이 로직을 `pnpm --filter ... inquiry:*` 서브프로세스로 불렀다 → 함수 호출로 통일.)

export { loginAlibaba } from "./cli/login-session";
export { extractAlibaba } from "./cli/extract-session";
export { sendAlibaba } from "./cli/send-session";
// 순수 변환(알리바바 raw → ingest DTO). 에이전트 push가 알리바바를 서버로 올릴 때 사용.
export {
  alibabaToIngestConversations,
  normalizeAlibabaGrade,
  type AlibabaIngestConversation,
  type AlibabaContactMetadata
} from "./normalize";
// SNS 디스커버리 통합 지점(라이브 브라우저 필요). 에이전트가 바이어별로 호출해 metadata.sns 를 채울 때 사용.
export { discoverBuyerSns, type DiscoverBuyerSnsInput, type AlibabaHeadlessDiscoveryOptions } from "./headless";
// 사용자가 이미 깐 크롬 실행파일 경로 탐색(없으면 null). 에이전트가 SNS 디스커버리에 같은 크롬을
// executablePath 로 넘길 때 쓴다(별도 Playwright 브라우저 다운로드 없이 동작).
// 공통 Chrome 스캐폴딩(자동화 플래그 없는 순수 크롬 + CDP) — 새 브라우저 리더가 4번째 복사 없이
// 재사용한다(예: WhatsApp Web 이름 리더). spawnChrome/waitForCdp/delay 까지 함께 노출.
export { findChrome, spawnChrome, waitForCdp, delay } from "./cli/chrome-cdp";
