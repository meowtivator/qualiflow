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

## Inquiry network recording

The inquiry recorder reuses a locally saved Alibaba browser session, opens OneTalk, and records fetch/XHR traffic while the operator manually clicks inquiry lists and buyer threads.

```bash
pnpm --filter @qualiflow/adapter-alibaba inquiry:record
```

Default URL:

```text
https://onetalk.alibaba.com/message/weblitePWA.htm?spm=a2700.product_home_fy25.home_header.108.2ce23a90UlLW4M&isGray=1&from=menu&hideMenu=1#/
```

Expected local files:

- `../../.auth/alibaba.storage.json` - Playwright `storageState` from a manual Alibaba login.
- `../../.captures/alibaba-inquiry/...` - ignored capture output with HAR, network events, WebSocket events, IndexedDB snapshots, and redacted response previews.

The recorder does not automate login, bypass CAPTCHA, or send messages. It only records network traffic that the logged-in operator can already access in the browser.

Capture outputs:

- `network-events.jsonl` - request/response metadata for fetch and XHR traffic.
- `responses/*.txt` - redacted text previews for readable fetch/XHR response bodies.
- `websocket-events.jsonl` - CDP WebSocket open/close/frame metadata with redacted payload previews.
- `indexeddb-snapshot.json` - browser IndexedDB database/store names, counts, key lists, and small redacted sample records from the current OneTalk page.
- `network.har.zip` - browser HAR archive for low-level replay/debugging.
- `summary.json` - capture file locations and event counts.

Useful options:

```bash
pnpm --filter @qualiflow/adapter-alibaba inquiry:record -- \
  --indexeddb-sample-records 5 \
  --max-websocket-payload-chars 40000
```

Use `--no-indexeddb` when you only need network/WebSocket data. The recorder stores redacted previews for analysis, not raw buyer message exports.
