# Account Connector Strategy

QualiFlow's channel integrations should model the operator's actual account inbox whenever possible.

The product is not a bot inbox. It is a CRM inbox for messages that arrive in accounts already used by the operator or client team.

## Principle

```text
Operator-owned channel account
  -> connector runtime
  -> raw dialogs/messages/events
  -> pure adapter normalize
  -> Lead / ChannelIdentity / Thread / Message
  -> storage
  -> unified inbox
```

## Runtime vs Adapter

| Layer | Owns | Must not own |
| --- | --- | --- |
| Connector runtime | login, session files, cookies, QR pairing, phone-code flow, cursors, polling, send API calls | domain UI decisions |
| Adapter package | deterministic normalization, fixture tests, channel metadata | tokens, passwords, cookies, session strings |
| Web app | display, filtering, operator actions | raw third-party credentials |

## Channel Direction

| Channel | Preferred account model | Auth mode | Notes |
| --- | --- | --- | --- |
| Alibaba | User account browser session | `browser_session` | Already follows this direction through Playwright storage state. |
| Telegram | User account client API | `phone_code` | Use MTProto/TDLib/gotd-style runtime. Bot API is not product-fit. |
| WhatsApp | User account / paired device where allowed | `qr_pairing` | Official business API may be used for business accounts, but adapter stays account-based. |
| Instagram | User/professional account session | `oauth` or `browser_session` | Use official API where available; otherwise treat as controlled connector spike. |
| LINE/Kakao/WeChat | User/business account connector | `qr_pairing`, `oauth`, or `browser_session` | Each channel needs a legal and operational feasibility check. |

## Why Not Bot-first

Bot APIs generally only see messages sent directly to the bot. QualiFlow needs the conversations that arrive in the operator's existing sales/support accounts.

Telegram is the clearest example: Bot API cannot read the user's normal Telegram inbox. Therefore the main Telegram path must be user account based.

## Security Boundary

- Never commit session files, browser profiles, QR sessions, cookies, API keys, or phone-code artifacts.
- Store connection status and cursor in application storage.
- Store the actual session in runtime-only local storage or a dedicated encrypted secret store.
- If a channel bans or discourages third-party clients, the connector must surface risk clearly before production use.

## Adapter Contract

Adapters expose:

- `accountKind`
- `authMode`
- `capabilities`
- optional `syncMessages()`
- optional `sendMessage()`

Actual login and send implementation is still runtime-owned. The adapter only defines the shape that runtime code must satisfy.

## Connection Status Contract

The web app must not infer “connected” from scraped conversations or browser tabs. A channel is connected only when the connector runtime reports an active `channel_connection`.

For the current file-backed prototype, runtime status can be reported through `.data/connector-status.json`:

```json
[
  {
    "id": "instagram:jaewoo-main",
    "channel": "instagram",
    "accountLabel": "Jaewoo Instagram",
    "ownerLabel": "Jaewoo Park",
    "accountKind": "user_account",
    "authMode": "browser_session",
    "status": "active",
    "checkedAt": "2026-06-20T00:00:00.000Z",
    "lastSyncedAt": "2026-06-20T00:00:00.000Z",
    "detail": "Runtime confirmed the Instagram session."
  }
]
```

Alibaba has one extra local-prototype path: `packages/adapter-alibaba` creates a persistent Chrome profile through `inquiry:login`, then writes `.data/alibaba-connection.json` as the explicit connection status. The web app reads the status file, not the raw browser profile. Conversation JSON files are still not connection evidence.

Instagram follows the same local-prototype direction through `packages/adapter-instagram`:

```bash
pnpm --filter @qualiflow/adapter-instagram run inbox:login -- --web
```

This command opens a dedicated Chrome profile at `../../.auth/instagram-chrome-profile` and writes `.data/instagram-connection.json` after the operator confirms Instagram Direct is visible. A normal browser tab that is already logged in is not enough, because the QualiFlow web app cannot inspect cross-origin Instagram cookies, DOM, or localStorage. The runtime profile is the inspected boundary.

In the product UI, operators should not be asked to run this command manually. The connector card calls `POST /api/connectors/launch`, and the server-side local runtime starts the dedicated Chrome profile. This only works when the web server is running on the same machine that can open the operator's browser. A hosted QualiFlow server cannot open or inspect a user's local Instagram session; hosted production needs one of these paths:

- official OAuth/API where the platform allows it,
- a signed desktop connector agent that runs beside the user's browser,
- a browser extension/native companion that reports connection status back to QualiFlow.

When Supabase persistence is enabled, this same state maps to `channel_connections`. Multiple users and multiple accounts are modeled as multiple rows, not as one channel-level flag.

## Disconnect and Data Deletion

Deleting a connected account must ask for scope:

1. Disconnect only - remove the connection status/session reference but keep synced lead/thread/message data.
2. Disconnect and delete synced data - remove the connection and the channel data imported through that account.

The file-backed prototype maps this to `*-connection.json` and optionally `*-conversations.json` deletion. The future Supabase-backed implementation should apply the same choice to `channel_connections` and related `threads/messages`, without silently deleting buyer records.
