# @qualiflow/adapter-alibaba

Alibaba inbound buyer adapter for QualiFlow.

This package does not scrape Alibaba. It defines the first integration boundary:

- normalize Alibaba buyer/inquiry data into QualiFlow `Lead`
- expose an Alibaba `ConversationAdapter` shape for imported or synced data
- build search candidates for sub-channel discovery such as Instagram, LinkedIn, and Facebook
- run optional headless discovery against generated search URLs

## Headless discovery

The headless runner reads a JSON dataset, generates buyer/company/location search URLs, opens them with Playwright, and returns matched website/social links.

```bash
pnpm --filter @qualiflow/adapter-alibaba headless:discover -- \
  --input ./alibaba-buyers.json \
  --output ./discovery-report.json \
  --channel chrome
```

Input must be a JSON array matching `AlibabaInboundBuyer`.

```json
[
  {
    "externalLeadId": "ali-1001",
    "buyerName": "Olivia Grant",
    "companyName": "Harbor Beauty Imports",
    "countryCode": "US",
    "receivedAt": "2026-05-17T10:00:00.000Z"
  }
]
```

Use `--headed` when debugging the browser. Use `--executable-path /path/to/browser` when the host does not have a Chrome channel available.

The runner does not bypass login, CAPTCHA, or anti-bot checks. If a search page requires human verification, the report marks that candidate as `blocked`.
