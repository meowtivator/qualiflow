// 클라우드 서버 주소. 로컬 검증은 localhost, 배포 후엔 실제 도메인을 환경변수로 준다.
export const CLOUD_BASE_URL = (process.env.QUALIFLOW_CLOUD_URL ?? "http://localhost:3000").replace(/\/$/, "");
