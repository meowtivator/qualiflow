# @qualiflow/adapter-telegram

Telegram user-account dialog adapter for QualiFlow.

This package is not a Telegram Bot API adapter. Bot API only receives messages sent to the bot, so it does not fit QualiFlow's main requirement: syncing the operator's real Telegram inbox.

This package expects a runtime connector such as MTProto, TDLib, or gotd to log in as the user account and pass captured dialogs/messages into the adapter.

```ts
import { createTelegramAdapterFromUserDialogs } from "@qualiflow/adapter-telegram";

const adapter = createTelegramAdapterFromUserDialogs(dialogs, {
  operatorDisplayName: "Operator"
});
```

Supported in this first pass:

- user/private dialogs
- group/supergroup/channel dialog ids
- text messages
- inbound/outbound direction using the connector-provided `outgoing` flag
- user-account adapter metadata: `accountKind=user_account`, `authMode=phone_code`

Out of scope for this package:

- phone login, QR login, 2FA, or session file storage
- direct MTProto/TDLib API calls
- secret/token storage
- actual message sending implementation

Those responsibilities belong in a runtime connector package.
