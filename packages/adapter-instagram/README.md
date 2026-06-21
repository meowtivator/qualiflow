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

In the web UI, the Instagram connector calls:

```text
POST /api/connectors/launch
```

That API starts this runtime in web mode and opens the dedicated Chrome profile.
When Instagram Direct becomes visible, the runtime writes the connector status
file automatically.

The CLI remains available for development/debugging:

```bash
pnpm --filter @qualiflow/adapter-instagram run inbox:login -- --web
```

The command opens Chrome with `../../.auth/instagram-chrome-profile`.

- In web mode, the runtime polls the dedicated Chrome profile until Instagram
  Direct is visible.
- Without `--web`, the command stays interactive and waits for Enter.

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
