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
