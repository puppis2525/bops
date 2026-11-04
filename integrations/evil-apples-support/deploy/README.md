# Private runtime deployment checklist

Prepared configuration, not an installed or running deployment. The source PR
remains draft. Do not replace an existing Bops runner or its credentials.

## Runtime layout

Use an existing Linux computer only after confirming its owner, available Node
version, capacity, and persistence across stops/restarts. The Bops runner docs
use supervisord for Orgo Linux; this companion gets a distinct program name.

| Path | Contents |
|---|---|
| `/opt/evil-apples-support/` | `cli.mjs`, `queue.mjs`, `wix.mjs`, `server.mjs`, `review.html`, `review.js`, `review.css` from the reviewed source revision |
| `/etc/evil-apples-support/runtime.env` | Populated copy of `runtime.env.example`, mode 0600 |
| `/etc/evil-apples-support/wix-webhook-public.pem` | Public signing key from the selected Wix custom app |
| `/var/lib/evil-apples-support/` | Private persistent data directory, mode 0700 |
| `/etc/supervisor/conf.d/evil-apples-support.conf` | Copy of `supervisor.conf`, initially `autostart=false` |

Node 24 is recommended. Runtime files use only Node built-ins; the full Bops
dependency tree is unnecessary. Copy the repository license with the runtime.
Use a dedicated OS account if the host supports it, ensure it owns the private
directories, and add its verified username as Supervisor's `user` setting. Do
not guess an existing host username or silently change another service's owner.

## Configure before starting

1. Verify the target Orgo computer and take note of its lifecycle/persistence
   settings. No computer has been selected or created by this change.
2. Place the seven runtime source files and the license in the code directory.
3. Set a read-only Wix runtime credential and review password directly through
   secure host configuration. The ChatGPT Wix connection is separate. Do not
   extract or repurpose its credentials.
4. Confirm the Wix custom app, Read Inbox Messages permission, installation ID,
   and webhook public key. Set the site ID from authenticated site context.
5. Set the callback's exact hostname and route only `/hooks/wix` through a TLS
   reverse proxy. The review page remains loopback/private. Do not expose the
   Bops server port. Reverse proxy and certificates are not provisioned here.
6. Install the Supervisor program. Explicitly start `evil-apples-support` for
   validation; the provided configuration does not autostart it.

Creating a new computer, changing host exposure, provisioning credentials,
subscribing a webhook, and choosing a paid plan are separate external actions;
none is performed by these files.

## Acceptance before unattended operation

- Start with a canonical test conversation and verify one-shot sync and review.
- Deliver one real signed test event from the configured app/site. Confirm the
  job persists and creates exactly one case; replay it and verify no duplicate.
- Submit an unsigned event and an event from a different installation; both
  must fail without creating work.
- Approve a draft, then add a new participant message and verify approval is
  invalidated. No message may be sent by this service.
- Restart the process, then the computer, and confirm the case and audit remain.
- Test the backup/restore process with a disposable database. Do not copy an
  active SQLite database without a consistent backup strategy.
- Verify publicly that review routes are unreachable and only the intended
  webhook path is forwarded. A valid signed event is still required.
- Only after those checks, change `autostart` to true deliberately and monitor
  failed jobs and service health. Set retention and ongoing backup operations
  before collecting a broader player-support sample.

Remaining host decisions: computer ID, durable storage location, callback
hostname/TLS route, operating-system identity, and secret provisioning. The
application cannot answer these from source code alone.
