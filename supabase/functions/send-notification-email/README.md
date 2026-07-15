# send-notification-email (A12)

Sends branded notification emails via Resend. Invoked **asynchronously by the
database** (`pg_net`) after an in-app notification is written — see
`invoke_send_notification_email()` and `emit_in_app_notification()` in
`supabase/migrations/20260715100000_email_notifications.sql`.

## Flow
1. DB writes the in-app notification, then POSTs `{ notification_id }` to this
   function with an `X-Webhook-Secret` header.
2. Function loads the notification, the recipient's `profiles.email`, and their
   `notification_preferences`.
3. Skips (records `notification_deliveries.delivery_status='skipped'` + reason)
   when email is disabled for the event, `digest_mode` is on, or the current
   time is within the recipient's quiet hours (`Africa/Johannesburg`).
4. Otherwise sends via Resend and records `sent` (with the Resend id) or
   `failed` (with the error).

## Setup (owner / deploy step — do NOT commit any of these values)

**1. Edge Function environment variables** (Supabase Dashboard → Edge Functions
→ `send-notification-email` → Secrets, or `supabase secrets set`):

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | Your Resend API key (`re_…`). |
| `WEBHOOK_SECRET` | A long random string (e.g. `openssl rand -hex 32`). Must match the Vault secret below. |
| `APP_BASE_URL` | The CRM's public base URL, e.g. `https://app.fundnowcapital.africa` (used for the "View in CRM" + preferences links). |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do
not set them.

**2. Vault secrets** (so the DB trigger can reach this function). Run once, with
your real values:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'edge_base_url');
select vault.create_secret('<same WEBHOOK_SECRET as above>',     'webhook_secret');
```

If these are absent, `invoke_send_notification_email()` is a no-op — in-app
notifications still work, email just won't fire.

**3. Deploy** with JWT verification **off** (it authenticates via the shared
secret, not a user JWT):

```bash
supabase functions deploy send-notification-email --no-verify-jwt
```

## Local sanity check

```bash
curl -i -X POST "$SUPABASE_URL/functions/v1/send-notification-email" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"notification_id":"<an existing notification id>"}'
```
