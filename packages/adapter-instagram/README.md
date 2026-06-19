# @qualiflow/adapter-instagram

Instagram conversation adapter for QualiFlow.

This package does not log in to Instagram by itself. A connector runtime is
responsible for authenticating either:

- a Meta professional account through the official Instagram Messaging/Graph API, or
- a controlled user-session collector during a feasibility spike.

The runtime exports account conversations, and this adapter normalizes them into
QualiFlow leads, threads, and messages.

```ts
import { createInstagramAdapterFromConversations } from "@qualiflow/adapter-instagram";

const adapter = createInstagramAdapterFromConversations(conversations);
const result = await adapter.syncMessages?.();
```

Secrets, OAuth tokens, browser cookies, and session files must remain in the
runtime layer. They should not be passed into this adapter.
