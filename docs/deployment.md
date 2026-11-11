# NetSleuth deployment

This guide covers the supported initial Linux validation architecture:

```text
Ubuntu host
  ├─ NetSleuth agent (direct process; observes the host's ss socket table)
  └─ Docker Compose
       ├─ PostgreSQL (internal Compose network and persistent volume)
       ├─ Express API + Socket.IO (published API port)
       └─ Next.js frontend (published web port)
```

The agent is deliberately not part of the default Compose stack. A normal
container has its own network namespace and cannot automatically observe the
Ubuntu host's sockets.

## Recommended Ubuntu environment

For initial validation use Ubuntu Server 24.04 LTS (64-bit) in a VM. Ubuntu
22.04 LTS is also supported by the commands below.

Recommended minimums:

- 2 vCPUs
- 4 GB RAM
- 20 GB free disk
- A user with `sudo`
- Outbound HTTPS access from the agent to the API
- Inbound access to the web port and API port only from the validation client

The current development machine is macOS. It cannot validate Linux-only
`ss` collection or host network visibility.

## Install Ubuntu prerequisites

Update the VM and install host tools:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git iproute2 openssl
```

Install Docker Engine and the Compose plugin using Docker's Ubuntu repository:

```sh
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

Install Node.js 22 and pnpm 10.26.1 for building and running the host agent:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
sudo corepack prepare pnpm@10.26.1 --activate
node --version
pnpm --version
```

Log out and back in if the Docker group change is not active in the current
shell.

## Clone and configure

```sh
git clone <repository-url> netsleuth
cd netsleuth
cp .env.docker.example .env
chmod 600 .env
```

Generate local secrets without printing them:

```sh
python3 - <<'PY'
from pathlib import Path
import secrets

path = Path(".env")
text = path.read_text()
text = text.replace(
    "replace-with-a-local-password",
    secrets.token_urlsafe(32),
).replace(
    "replace-with-a-random-secret-at-least-32-characters",
    secrets.token_urlsafe(48),
).replace(
    "replace-with-a-different-random-secret-at-least-32-characters",
    secrets.token_urlsafe(48),
)
path.write_text(text)
PY
```

For a plain HTTP VM validation, keep these local values:

```env
CORS_ORIGINS=http://<ubuntu-host>:3000
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
```

The Compose API uses `postgres:5432` internally. PostgreSQL is not published
to the host. The agent uses the Ubuntu host's API address:

```env
NETSLEUTH_API_URL=http://<ubuntu-host>:4000
```

For production HTTPS, put TLS termination in front of the API and frontend,
use the public HTTPS origins in `CORS_ORIGINS` and `NETSLEUTH_API_URL`, and set
`COOKIE_SECURE=true`. The agent rejects HTTP when `NODE_ENV=production`.

## Firewall

Do not open PostgreSQL port 5432. The database is only reachable by Compose
services on the internal network.

For a VM where only a validation workstation needs access:

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <validation-client-ip> to any port 3000 proto tcp
sudo ufw allow from <validation-client-ip> to any port 4000 proto tcp
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

If the agent and containers run on the same Ubuntu host, the agent reaches
`127.0.0.1:4000`; no additional firewall rule is needed for that local path.

## Start the Docker services

Validate interpolation, build, and start:

```sh
docker compose --env-file .env config
docker compose build
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:4000/health/ready
curl -fsS http://127.0.0.1:3000/login
```

Startup order is enforced:

1. PostgreSQL becomes healthy.
2. The one-shot `migrate` service applies pending Drizzle migrations.
3. The API starts and must pass `/health/ready`.
4. The frontend starts.

Inspect failures:

```sh
docker compose logs --no-color postgres migrate api web
```

Open `http://<ubuntu-host>:3000` from the validation workstation. The frontend
uses the internal Next.js rewrite destination `http://api:4000`; that hostname
must not be placed in a browser URL.

## Register an agent

Register the agent through the authenticated dashboard or the existing API:

```text
POST /api/v1/projects/<project-id>/agents
```

The response contains the agent key once. Store it only on the Ubuntu host and
do not place it in Git, a Docker image, shell history, or a command-line
argument.

Create the ignored agent environment file:

```sh
cp apps/agent/.env.example apps/agent/.env
chmod 600 apps/agent/.env
```

Set:

```env
NETSLEUTH_API_URL=http://127.0.0.1:4000
NETSLEUTH_AGENT_KEY=ns_agent_<64 lowercase hexadecimal characters>
COLLECTION_INTERVAL_MS=2000
HEARTBEAT_INTERVAL_MS=30000
NODE_ENV=development
```

Use the Ubuntu host's reachable address instead of `127.0.0.1` if the agent
will run under a separate network namespace. The URL is the API base only; the
agent appends `/api/v1/ingest/events`.

## Build and run the host agent

From the repository root on Ubuntu:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@workspace/netsleuth-agent...
pnpm --filter @workspace/netsleuth-agent start
```

The executable loads `apps/agent/.env`, runs `ss -H -n -t -u -a`, publishes
new observations in batches of at most 100, sends a heartbeat immediately and
every 30 seconds, retries temporary publish failures at most three times, and
handles `SIGINT`/`SIGTERM` gracefully. Undelivered observations are persisted
in the local `.netsleuth-agent-spool.json` file (or `NETSLEUTH_SPOOL_PATH`),
bounded to 10,000 events and 24 hours, and removed only after API
acknowledgement.

Keep it running in a dedicated service manager rather than a terminal for
repeatable validation. Example systemd unit (replace the paths and user):

```ini
[Unit]
Description=NetSleuth host monitoring agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=netsleuth
WorkingDirectory=/opt/netsleuth
ExecStart=/usr/bin/pnpm --filter @workspace/netsleuth-agent start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Save it as `/etc/systemd/system/netsleuth-agent.service`, then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now netsleuth-agent
sudo journalctl -u netsleuth-agent -f
```

The agent does not need `sudo` for ordinary `ss` metadata on a standard Ubuntu
host. If the host policy denies access, the logs report the permission error;
do not grant broad privileges without confirming the local requirement.

## Controlled host-level validation

Run these checks while the agent is active. Use only systems you own or are
authorized to test.

First confirm the collector sees the host socket table:

```sh
ss -H -n -t -u -a
```

Generate a persistent TCP connection so a polling cycle can observe it:

```sh
# Terminal A: keep a local listener open.
nc -l 127.0.0.1 18080

# Terminal B: connect and leave the session open.
nc 127.0.0.1 18080
```

Generate ordinary HTTP traffic to the local API:

```sh
curl -fsS http://127.0.0.1:4000/health
```

If an authorized controlled PostgreSQL service is available, keep a client
session open long enough for a poll:

```sh
psql "$CONTROLLED_POSTGRES_URL" -c 'select 1'
```

Check the agent journal for inserted counts, then inspect the project-scoped
Events page or API. A successful TCP connection is only a network observation;
it is not proof of application authentication success or failure.

Expected collector semantics:

- TCP `SYN-SENT`/`SYN-RECV`: `NETWORK_CONNECTION_ATTEMPT`
- TCP `ESTAB`: `NETWORK_CONNECTION_ESTABLISHED`
- UDP peer association: established event with explicit UDP metadata, not a
  handshake claim
- TCP listeners and wildcard UDP bindings: `SERVICE_DISCOVERED`
- IPv4 and IPv6 endpoints are parsed from `ss` output when addresses are
  present
- unchanged observations are suppressed in memory

Short-lived connections can be missed between polls. Restarting the agent
resets its in-memory snapshot, but undelivered observations survive in the
local spool and retain their event IDs for idempotent retry.

## Pipeline evidence checklist

Record evidence for each validation run:

1. `systemctl status netsleuth-agent` and journal heartbeat/publish messages.
2. API response from `/health/ready`.
3. Ingestion response counts (`insertedCount` and `duplicateCount`).
4. Project-scoped event record containing the registered `agentId`.
5. Any alert only when the persisted detection rule conditions are met.
6. Socket.IO dashboard update while the selected project is open.
7. Replaying the same event IDs returns duplicates without new rows or
   duplicate alert emissions.

The API marks each persisted event as pending detection until the detection
transaction succeeds. A bounded reconciliation pass runs at API startup and
every 30 seconds, so a failed post-ingestion detection attempt is retried
without creating duplicate alerts.

To test invalid credentials safely, stop the agent and use a deliberately
invalid key against the ingestion endpoint; expect HTTP 401. Never expose a
real key in a command, log, or report.

## Failure and recovery tests

These tests do not reset or delete data:

```sh
# API outage/recovery
docker compose stop api
# Observe bounded agent retries in journalctl.
docker compose start api

# Container restarts
docker compose restart api web postgres
docker compose ps
curl -fsS http://127.0.0.1:4000/health/ready

# Agent graceful shutdown
sudo systemctl stop netsleuth-agent
sudo systemctl start netsleuth-agent
```

After PostgreSQL restarts, confirm the named volume remains attached and
previous records are still visible. Do not use `docker compose down -v` during
validation; that deletes the database volume.

## Migrations and shutdown

Pending migrations run automatically during `docker compose up`. They can also
be run explicitly:

```sh
docker compose run --rm migrate
```

Stop without deleting data:

```sh
docker compose down
```

The `netsleuth-postgres` named volume persists across ordinary shutdowns.

## Host versus container monitoring

- **Direct host agent:** observes the Ubuntu host's network namespace and is
  the supported initial validation mode.
- **Normal agent container:** observes only the container namespace; it does not
  automatically see host connections.
- **Agent container with host networking:** may observe the host namespace on
  Linux, but changes isolation and may require additional permissions. It is
  intentionally not enabled here.

The optional `Dockerfile.agent` installs `iproute2` for container-local
collection. It is not a substitute for direct host monitoring.

## Troubleshooting

- `ss: command not found`: install `iproute2`.
- Agent says configuration is invalid: verify the API base URL, key format,
  interval range, and `NODE_ENV`/HTTP-versus-HTTPS combination.
- Agent receives 401: verify the key belongs to a non-revoked agent and that
  its project is the intended project.
- API is unhealthy: inspect `docker compose logs api postgres migrate`; confirm
  Compose uses `postgres:5432`, not `localhost`.
- No events appear: keep a socket open across at least one collection interval,
  inspect `ss`, confirm the agent journal, then check API logs.
- No alert appears: ordinary connection events do not create authentication
  failure alerts. Database alerts require a configured policy and an actual
  out-of-policy connection observation.
- No realtime update appears: verify the browser is on the selected project,
  API health is green, and the frontend/API origin and cookies are configured
  consistently.
