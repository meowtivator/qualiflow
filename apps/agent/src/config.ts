// 클라우드 서버 주소. 로컬 검증은 localhost, 배포 후엔 실제 도메인을 환경변수로 준다.
export const CLOUD_BASE_URL = (process.env.QUALIFLOW_CLOUD_URL ?? "http://localhost:3000").replace(/\/$/, "");

// 설치본 버전 — 릴리스 태그(agent-vX.Y.Z)의 X.Y.Z. package-app.mjs 가 빌드 시 AGENT_VERSION 을
// 런처(run.sh/run.cmd)에 주입하고, 런처가 이 env 로 넘긴다. 개발 중(레포에서 직접 실행)엔 주입이
// 없으니 "dev" — 웹은 "dev"를 "감지 안 됨/미배포"로 다룬다(업데이트 비교 안 함).
export const AGENT_VERSION = process.env.QUALIFLOW_AGENT_VERSION || "dev";
