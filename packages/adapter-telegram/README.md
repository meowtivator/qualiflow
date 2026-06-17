# @qualiflow/adapter-telegram

Telegram Bot API adapter for QualiFlow.

This package handles the first official-API channel verification path:

- accept Telegram Bot API `Update[]` payloads
- normalize message updates into `ChatRawConversation[]`
- expose a standard QualiFlow `ConversationAdapter`

It does not store bot tokens, call Telegram APIs, or send messages. Webhook receivers and polling workers should live in a server/runtime layer and pass captured updates into this adapter.

```ts
import { createTelegramAdapterFromUpdates } from "@qualiflow/adapter-telegram";

const adapter = createTelegramAdapterFromUpdates(updates, {
  botUserId: 123456789
});
```

Supported in this first pass:

- `message.text`
- `message.caption`
- `message.from`
- `message.chat`
- private, group, supergroup, and channel chat ids

Unsupported payloads are ignored conservatively.
