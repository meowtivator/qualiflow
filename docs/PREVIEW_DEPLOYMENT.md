# Protected real-data preview

This preview mode is for reviewing QualiFlow with real extracted channel data before the Supabase-backed store is complete.

## Goal

```text
public preview URL
  -> HTTP Basic Auth password
  -> file-backed real JSON inbox
```

The preview is intentionally simple. It is not the long-term multi-tenant production model.

## Runtime behavior

The web app loads conversations in this order:

1. `apps/web/.data/*.json` exists and contains records: render real channel JSON through the adapters.
2. No usable `.data` file exists: fall back to `@qualiflow/adapter-mock`.

The UI shows the active data mode in the top bar:

- `Real JSON preview`: at least one real channel file was loaded.
- `Mock data`: no real channel file was loaded.

## Connector login limitation

The hosted preview can display extracted JSON and connection status files, but it
cannot open or inspect a reviewer's local browser session.

For user-session channels such as Instagram, a button in the hosted preview
cannot directly connect the reviewer's personal account. That requires one of
these production paths:

- local/self-host QualiFlow running on the same machine as the browser,
- a desktop connector agent,
- a browser extension/native companion,
- or an official OAuth/API connector where the platform supports it.

The local web flow still exists: `POST /api/connectors/launch` can start a local
runtime only when the web server is running on the same machine that has Chrome.

## Data files

The preview data directory is gitignored and must be mounted or copied separately.

```text
apps/web/.data/alibaba-conversations.json
apps/web/.data/telegram-dialogs.json
apps/web/.data/telegram-conversations.json
apps/web/.data/instagram-conversations.json
apps/web/.data/whatsapp-conversations.json
```

Never commit real buyer data, cookies, tokens, browser profiles, or session files.

## Environment

```env
QUALIFLOW_DEMO_PASSWORD=shared-preview-password
QUALIFLOW_DISABLE_AUTH=
```

When `QUALIFLOW_DEMO_PASSWORD` is set, the app uses HTTP Basic Auth before any page is shown and skips the Supabase login gate. The username can be any value; the password must match `QUALIFLOW_DEMO_PASSWORD`.

## Health check

Use `/healthz` for container/load-balancer checks. It is intentionally public so the health check does not fail when Basic Auth protects `/`.

```bash
curl -I https://<preview-domain>/healthz
```

## Current OCI layout

The current OCI preview layout is:

```text
/srv/web/qualiflow                 # app checkout/build context
/srv/data/qualiflow                # mounted as /app/apps/web/.data:ro
/srv/infra/compose/qualiflow       # compose service
```

The compose service should mount the data directory read-only:

```yaml
volumes:
  - /srv/data/qualiflow:/app/apps/web/.data:ro
```

## Supabase extension path

The file-backed preview is a temporary `ConversationStore` implementation. The next durable step is:

```text
raw extracted JSON
  -> normalize with channel adapter
  -> upsert into Supabase
  -> SupabaseConversationStore
  -> same inbox UI
```

Keep this boundary intact:

- `ConversationStore`: read normalized leads, threads, messages.
- `ConnectionStore`: channel account connection status and sync cursors.
- `CredentialStore`: encrypted tokens, cookies, QR sessions, MTProto sessions.
- `SyncStore`: sync jobs, errors, and raw event archive references.

The UI should not call Supabase tables directly for inbox data. It should call a store/adapter boundary that can be backed by files today and Supabase later.
