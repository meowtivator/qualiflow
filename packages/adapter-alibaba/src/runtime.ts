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
  parseAlibabaGrade,
  type AlibabaIngestConversation,
  type AlibabaContactMetadata
} from "./normalize";
// SNS 디스커버리 통합 지점(라이브 브라우저 필요). 에이전트가 바이어별로 호출해 metadata.sns 를 채울 때 사용.
export { discoverBuyerSns, type DiscoverBuyerSnsInput } from "./headless";
