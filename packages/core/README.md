# @qualiflow/core

Shared TypeScript contracts for QualiFlow.

This package does not talk to WhatsApp, Instagram, Alibaba, Supabase, or any UI directly. It defines the common shape that adapters, apps, databases, and LLM workflows agree on.

## Contracts

- `Lead`: the person or company that contacted a client.
- `clientId`: the optional client account this lead or thread belongs to.
- `Channel`: the source surface such as WhatsApp, Instagram, Alibaba, email, or manual entry.
- `Thread`: a conversation grouped by lead and channel.
- `Message`: a single inbound or outbound message inside a thread.
- `LeadQualification`: the A/B/C lead quality judgement and its evidence.
- `ConversationAdapter`: the interface external sources must implement.
- `ChannelConnection`: a connected operator-owned account. Secrets and sessions stay in the runtime layer, not in this contract.

## Account-based channels

QualiFlow's default integration model is an operator/user account inbox, not a bot inbox.

- Telegram should use a user-account connector such as MTProto/TDLib, not Bot API for the main product path.
- WhatsApp/Instagram can use official business APIs where available, but the adapter contract still models a connected account with read/send capabilities.
- Alibaba uses a browser-session connector because there is no prototype webhook for OneTalk inbox messages.

Adapters normalize already-captured channel data into `Lead`, `Thread`, and `Message`. Runtime connectors own login, credentials, session files, cursors, polling, and webhook verification.
