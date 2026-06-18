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
