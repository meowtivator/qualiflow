# @qualiflow/adapter-instagram

Instagram conversation adapter for QualiFlow.

This package does not log in to Instagram by itself. A connector runtime is
responsible for authenticating either:

- a Meta professional account through the official Instagram Messaging/Graph API, or
- a controlled user-session collector during a feasibility spike.

The runtime exports account conversations, and this adapter normalizes them into
QualiFlow leads, threads, and messages.

## Local user-session login spike

For the local prototype, the connector runtime can keep a dedicated Chrome
profile for Instagram. This is intentionally separate from the normal browser
session because the web app cannot inspect a cross-origin Instagram tab.

```bash
pnpm --filter @qualiflow/adapter-instagram run inbox:login
```

The command opens Chrome with `../../.auth/instagram-chrome-profile`.

- If Instagram Direct is already visible, press Enter and the runtime writes the
  connector status file.
- If not, log in manually, open Instagram Direct, then press Enter.

The status file is written to:

```text
../../apps/web/.data/instagram-connection.json
```

The web app reads that file through `/api/connectors/status`. Conversation
extraction is still a separate runtime step; this command only confirms that the
runtime profile is connected.

```ts
import { createInstagramAdapterFromConversations } from "@qualiflow/adapter-instagram";

const adapter = createInstagramAdapterFromConversations(conversations);
const result = await adapter.syncMessages?.();
```

Secrets, OAuth tokens, browser cookies, and session files must remain in the
runtime layer. They should not be passed into this adapter.
