# @qualiflow/adapter-whatsapp

WhatsApp adapter boundary for QualiFlow.

This package currently provides:

- WhatsApp inbound lead normalization
- WhatsApp message normalization
- `wa.me` deep link generation for manual follow-up
- an in-memory `ConversationAdapter` implementation for synced or imported WhatsApp data

The actual WhatsApp Cloud API webhook and send-message client should be added on top of these contracts.
