# @qualiflow/agent

QualiFlow의 **로컬 에이전트 코어**. 사용자 PC에서 돌며, 채널 인박스를 로컬에서 읽어 클라우드로 보낸다.
지금은 GUI 없는 코어(CLI)이며, 이후 단계에서 이 코어를 설치형 데스크톱 앱(Electron 등)으로 감싼다.

## 왜 로컬인가
Alibaba OneTalk 같은 채널은 공식 인박스 API가 없어 **로그인된 브라우저 세션**으로만 읽을 수 있고,
그 자동화를 클라우드(데이터센터 IP)에서 돌리면 봇 탐지에 막힌다. 그래서 채널 읽기/세션은 사용자 PC에 둔다.
클라우드는 보기·저장·UI를 담당한다.

## 명령 (커넥터 우선)
```bash
# ★핵심: 알리바바 커넥터 실행 → 라이브 인박스 읽기 → 정규화 (전용 크롬, 로그인 세션 필요)
pnpm --filter @qualiflow/agent fetch
# RE 없이 이미 추출된 데이터만 읽어 정규화(라이브 세션 없이 빠른 확인)
pnpm --filter @qualiflow/agent fetch -- --cached

# (보안 레이어 — 나중에) 페어링/상태
pnpm --filter @qualiflow/agent pair XXXX-XXXX
pnpm --filter @qualiflow/agent status
```

`fetch`는 기존 `inquiry:extract`(순수 크롬+CDP) RE를 **그대로 호출**한다(로직 미변경, 호출 위치만 에이전트로).
클라우드 주소는 기본 `http://localhost:3000`, 환경변수 `QUALIFLOW_CLOUD_URL`로 변경.

## 경계
- 토큰/세션은 **OS 키체인**에만(평문 파일 금지). 현재 macOS `security` 사용, 크로스OS는 설치형 단계에서.
- 정규화는 새로 짜지 않고 `@qualiflow/adapter-alibaba`를 재사용(공유 계약).

## 순서 (커넥터 먼저, 보안은 나중)
1. ✅ 에이전트에서 **Alibaba 커넥터 작동**(`fetch`) — 라이브 RE 호출 + 정규화.
2. 나머지 커넥터 작동: Instagram 리더(현재 로그인만) · Telegram MTProto · WhatsApp.
3. 그다음 **보안 레이어**: 페어링/키체인으로 묶고, 정규화 메시지를 클라우드로 `sync`(HTTP) → DB.
4. 웹 인박스가 DB를 읽어 표시.
5. Electron으로 감싸 설치형(트레이·autostart) + keepalive.
