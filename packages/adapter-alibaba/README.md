# @qualiflow/adapter-alibaba

Alibaba inbound buyer adapter for QualiFlow.

This package defines the Alibaba integration boundary:

- normalize Alibaba/OneTalk conversation data into QualiFlow `Lead`/`Thread`/`Message`
- expose an Alibaba `ConversationAdapter` shape for imported or synced data
- runtime connector (`./runtime`): operator-owned Chrome session — login, inbox
  extraction, message send, and headless SNS discovery used by `apps/agent`

The product direction is an operator-owned Alibaba/OneTalk browser session. Login
state, cookies, Chrome profiles, and relogin handling live in the runtime connector
(`src/cli/chrome-cdp.ts`, `extract-session.ts`, `send-session.ts`), not in the pure
adapter entrypoint.

## CLI (dev)

```bash
pnpm --filter @qualiflow/adapter-alibaba inquiry:login    # 로그인 창(세션 저장)
pnpm --filter @qualiflow/adapter-alibaba inquiry:extract  # 인박스 추출(정규화 JSON)
pnpm --filter @qualiflow/adapter-alibaba inquiry:send     # 메시지 발송
```

세 CLI 모두 로그인/CAPTCHA를 우회하지 않는다 — 로그인한 운영자가 브라우저에서 이미 접근할 수
있는 데이터만 읽고 쓴다. SNS 탐색(`headless.ts`의 `discoverBuyerSns`)은 `apps/agent`의
fetch 사이클이 직접 호출한다.

(과거 역공학용 네트워크 레코더 `record-inquiry.ts` 와 단독 headless CLI 는 extract-session /
agent 경로로 흡수되어 삭제됨 — 필요하면 git 히스토리 참조.)
