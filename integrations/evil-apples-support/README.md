# Evil Apples support intake and review

A companion service in the Bops fork. It reads Wix Inbox conversations, stores
cases and incoming jobs in SQLite, and provides an authenticated local review
page. It runs separately from Electron/Next.js and does not require Orgo for
API work. This is an internal Evil Apples pilot, under the repository's license.

## What works

- Signed Wix incoming-message webhook receipt, restricted to one configured app
  installation; durable dedupe and retry queue, up to five attempts.
- Full, bounded message pagination through a GET-only Wix adapter. Failed or
  incomplete snapshots do not replace a case.
- One case per site/conversation; exact message IDs and integer sequences kept
  as strings. Changed message context invalidates prior drafts and approvals.
- Editable intake templates for gameplay, purchases, or unclear issues.
  Sensitive keyword matches are flagged for human attention. These are simple
  heuristics, not an evaluated AI classifier or a complete abuse detector.
- Save, reject, or approve for manual sending, with revision checks and audit
  history. Live approval re-reads Wix first; an expired credential blocks it.
- Restart persistence and an isolated synthetic demo.

There is **no send, refund, entitlement change, merge, or deployment operation**
in this service. Approval does not send. Drafts remain in this queue; native Wix
unsent draft storage has not been established. The Bops chat tool registry and
main navigation are not wired to this companion yet.

## Run the synthetic demo

Use Node 22.13+ (Node 24 recommended), from the repository root:

```bash
export SUPPORT_REVIEW_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
npm run support:demo
```

Open <http://127.0.0.1:3221>. Browser authentication uses username `review` and
the password held in `SUPPORT_REVIEW_PASSWORD` (retrieve it locally from your
shell; do not paste it into chat). Synthetic demo data uses a separate database.
The demo performs no Wix requests. Its source link contains synthetic IDs.

## Live read configuration

Provide these through the deployment's secret manager/environment, never a
committed file. The ChatGPT Wix connection does not export these credentials.

| Variable | Meaning |
|---|---|
| `WIX_SUPPORT_SITE_ID` | Target site's confirmed UUID |
| `WIX_SUPPORT_AUTH` | Authorization header value for a separately provisioned Wix API key or access token with Read Inbox Messages; token renewal is external |
| `SUPPORT_REVIEW_PASSWORD` | Random password, at least 24 characters |
| `SUPPORT_DB` | Optional absolute SQLite path on a durable volume; default `.data/evil-apples-support/queue.sqlite` |
| `SUPPORT_PORT` | Optional local port, default 3221 |

Read an existing **canonical Inbox conversation ID** once:

```bash
node integrations/evil-apples-support/cli.mjs sync CANONICAL_CONVERSATION_UUID
npm run support:serve
```

Do not use the participant contact ID as the conversation ID. No real player
IDs or messages are included in the source or test fixtures.

## Incoming webhook configuration

After choosing a durable host, configure a Wix custom app subscription for
**Message Sent To Business**, a read permission, and a callback ending in
`/hooks/wix`. Set the confirmed installation ID and the public key supplied by
that app:

| Variable | Meaning |
|---|---|
| `WIX_SUPPORT_PUBLIC_KEY_FILE` | Absolute PEM public key file for verifying Wix RS256 signatures |
| `WIX_SUPPORT_INSTANCE_ID` | Installation ID bound to the selected Evil Apples site, verified during provisioning |
| `SUPPORT_WEBHOOK_HOST` | Exact callback hostname (and port if present), accepted only on the webhook route |

The webhook endpoint is disabled until these credentials are configured. Wix
sends a signed JWT as `text/plain`. The documented REST envelope has JSON-string
`data`, containing installation metadata and another JSON-string `data` for the
event. The handler validates the signature and installation, accepts only inbound
Inbox message events, and persists the event ID and conversation before returning
200. A worker retrieves authoritative conversation content; webhook message text
is not used to grant authority or generate a draft. Replay dedupe survives restart.

Completed event IDs are retained for dedupe. Failed jobs remain visible in the
review page; reconnect credentials, then use a fresh one-shot sync to recover the
case. An administrator can implement deliberate replay later; failed jobs are
never silently discarded. A job can be re-read after a crash between syncing and
completion; identical snapshots have no repeated external effect.

Run **one service process per database**, on a persistent local disk/volume.
SQLite is not a multi-host/cloud-synchronized Bops database. Back up the database
consistently, including WAL state (SQLite backup tooling or stop the service
before copying). Protect and eventually expire player records under an agreed
retention policy. A retention purge/backup scheduler is not implemented here.

The server binds to loopback. A TLS reverse proxy may forward **only**
`/hooks/wix` to it, with `SUPPORT_WEBHOOK_HOST` matching the forwarded Host.
Never publish the review routes or the main Bops port. Remote review needs a
separately authenticated private tunnel; browser Basic auth is for local access.

## Review policy

Customer text is untrusted data; it cannot trigger commands. Only static intake
templates run, without an LLM or account lookups. Messages render using
`textContent`, not HTML. Forms require same-origin JSON requests and
authentication. No screenshot, receipt, or contact ID verifies a game account.

Approval records a decision on the exact draft and case revision. It can become
stale after approval; a human must re-check the Wix conversation before manually
sending. New snapshots revoke approval. There is no automated sending path.

## Verification

```bash
npm run support:test
```

Tests exercise replay dedupe, persistence after restart, edit/new-message approval
invalidation, numeric precision, pagination failure, expired access, signature
tampering/algorithm/installation checks, authentication, cross-origin rejection,
and the receipt-to-case workflow with a mocked read-only Wix service.

Live event delivery, real runtime credentials, attachment handling, multi-user
review, deployment restart/backup restoration, full support-quality evaluation,
and Bops agent-tool integration remain launch gates. This change does not register
a Wix webhook or deploy any service. No external webhook has been accepted yet.

## API contracts consulted

- [Get Conversation](https://dev.wix.com/docs/api-reference/crm/communication/inbox/conversations/get-conversation)
- [List Messages](https://dev.wix.com/docs/api-reference/crm/communication/inbox/messages/list-messages)
- [Incoming message webhook](https://dev.wix.com/docs/api-reference/crm/communication/inbox/messages/message-sent-to-business)
- [REST webhook structure](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-the-structure-of-webhooks)
- [Verify webhook signatures](https://dev.wix.com/docs/build-apps/develop-your-app/develop-a-self-managed-app/webhooks/handle-events-with-webhooks-for-self-hosting-without-the-java-script-sdk)
