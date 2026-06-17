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
| Telegram | Webhook or `getUpdates` polling | Official Bot API payloads are stable enough for a first verification adapter. |
| WhatsApp | Meta webhook | Requires app setup, phone number id, access token, webhook verification. |
| Instagram | Meta webhook | Requires page/IG business connection and permissions. |
| Alibaba | Local browser/session polling | No official inbox webhook in this prototype. Treat it as a periodic extractor with manual re-login. |

## Data Boundary

The runtime layer owns credentials and sessions. The adapter layer only receives raw payloads and returns normalized data.

- Tokens, cookies, browser profiles, and webhook secrets stay outside `packages/*`.
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

## Cursor Strategy

- Official API channels store `sync_cursor` on `channel_connections`.
- Webhook channels can keep provider event ids for dedupe.
- Alibaba stores the last seen `conversationCode` + message id/time as a cursor, but session validity is controlled by the local browser profile.

## Verification Order

1. Normalize fixture payloads into `ConversationAdapter`.
2. Render normalized conversations in the web inbox through `.data/*.json`.
3. Add server-side webhook/polling receiver.
4. Persist normalized records into Supabase.
5. Replace file-based `.data` loading with DB-backed `ConversationAdapter`.
