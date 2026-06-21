# QualiFlow Sync Architecture

QualiFlow keeps the product UX as one inbox, but every channel enters through a channel-specific sync path.

```text
External channel
  -> connector runtime
  -> raw event payload
  -> channel adapter normalize
  -> Lead / ChannelIdentity / Thread / Message
  -> storage
  -> aggregate inbox UI
```

## Runtime Modes

| Channel | Preferred sync mode | Notes |
| --- | --- | --- |
| Telegram | MTProto/TDLib user-session polling or event stream | Bot API is not product-fit because it only sees messages sent to the bot. |
| WhatsApp | User-account QR pairing connector, or official business API where available | The adapter contract is account-based; runtime choice depends on deployment constraints. |
| Instagram | User-account/session connector, or Meta professional-account API where available | The adapter contract should normalize the operator's inbox, not a public bot feed. |
| Alibaba | Local browser/session polling | No official inbox webhook in this prototype. Treat it as a periodic extractor with manual re-login. |

## Data Boundary

The runtime layer owns credentials and sessions. The adapter layer only receives raw payloads and returns normalized data.

- Tokens, cookies, browser profiles, QR sessions, phone-code sessions, and webhook secrets stay outside `packages/*`.
- `packages/adapter-*` must be deterministic and testable with fixtures.
- `packages/core` remains the shared contract: `Lead`, `ChannelIdentity`, `Thread`, `Message`, `Qualification`.

## Storage Target

The durable store should upsert in this order:

1. `channel_connections` - connected account status and cursor.
2. `leads` - person/company level buyer record.
3. `channel_identities` - channel-specific identity linked to a lead.
4. `threads` - channel conversation linked to lead and channel identity.
5. `messages` - external message id deduped per channel thread.
6. `qualifications` / `draft_suggestions` - model or human output.

`channel_connections` is account-scoped. One workspace can have multiple Alibaba, Instagram, Telegram, or WhatsApp accounts, and those accounts can belong to different users. The row stores ownership, status, capabilities, cursor, and a `session_ref` pointer only. It never stores cookies, passwords, QR sessions, or phone-code artifacts.

## Cursor Strategy

- User-account connectors store `sync_cursor` on `channel_connections`.
- Webhook-capable channels can keep provider event ids for dedupe.
- Alibaba stores the last seen `conversationCode` + message id/time as a cursor, but session validity is controlled by the local browser profile.

## Disconnect Strategy

Disconnecting a channel account is a two-step decision.

- Session/status removal: the runtime invalidates or removes the session reference and marks the connection as disconnected.
- Data removal: the operator explicitly chooses whether synced threads/messages from that account should also be deleted.

For the local JSON preview, this means removing `<channel>-connection.json` first and optionally removing `<channel>-conversations.json` or equivalent raw preview files. For Supabase, it should become a transaction around `channel_connections`, `channel_identities`, `threads`, and `messages`.

## Verification Order

1. Normalize fixture payloads into `ConversationAdapter`.
2. Render normalized conversations in the web inbox through `.data/*.json`.
3. Add account-session connector runtime for polling/event streaming.
4. Persist normalized records into Supabase.
5. Replace file-based `.data` loading with DB-backed `ConversationAdapter`.
