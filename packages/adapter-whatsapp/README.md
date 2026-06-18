# @qualiflow/adapter-whatsapp

WhatsApp adapter boundary for QualiFlow.

This package currently provides:

- WhatsApp inbound lead normalization
- WhatsApp message normalization
- `wa.me` deep link generation for manual follow-up
- an in-memory `ConversationAdapter` implementation for synced or imported WhatsApp data

The main QualiFlow direction is operator-account messaging: a runtime connector logs in or pairs the operator's WhatsApp account and passes synced contacts/messages into this adapter. That runtime may be official where available or a WhatsApp Web style connector in controlled deployments.

This package does not store QR sessions, cookies, tokens, or credentials. The actual connector and send-message client should live outside this adapter package.
