# @qualiflow/agent

QualiFlow의 **로컬 에이전트 코어**. 사용자 PC에서 돌며, 채널 인박스를 로컬에서 읽어 클라우드로 보낸다.
지금은 GUI 없는 코어(CLI)이며, 이후 단계에서 이 코어를 설치형 데스크톱 앱(Electron 등)으로 감싼다.

## 왜 로컬인가
Alibaba OneTalk 같은 채널은 공식 인박스 API가 없어 **로그인된 브라우저 세션**으로만 읽을 수 있고,
그 자동화를 클라우드(데이터센터 IP)에서 돌리면 봇 탐지에 막힌다. 그래서 채널 읽기/세션은 사용자 PC에 둔다.
클라우드는 보기·저장·UI를 담당한다.

## 명령 (현재 코어)
```bash
# 1) 웹의 "에이전트" 화면에서 발급한 페어링 코드로 연결 (토큰을 OS 키체인에 저장)
pnpm --filter @qualiflow/agent pair XXXX-XXXX

# 2) 연결 상태 확인
pnpm --filter @qualiflow/agent status

# 3) 채널 읽기(샘플) → 기존 어댑터로 정규화 → 요약 출력
pnpm --filter @qualiflow/agent read
```

클라우드 주소는 기본 `http://localhost:3000`, 환경변수 `QUALIFLOW_CLOUD_URL`로 변경.

## 경계
- 토큰/세션은 **OS 키체인**에만(평문 파일 금지). 현재 macOS `security` 사용, 크로스OS는 설치형 단계에서.
- 정규화는 새로 짜지 않고 `@qualiflow/adapter-alibaba`를 재사용(공유 계약).

## 다음 단계
1. 정규화 메시지를 클라우드로 `sync`(HTTP) → DB 멱등 저장.
2. 웹 인박스가 DB를 읽어 표시.
3. fixture 자리에 실제 RE(기존 `inquiry:extract`) 연결.
4. Electron으로 감싸 설치형(트레이·autostart) + keepalive.
