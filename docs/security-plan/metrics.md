# Metrics and alerts (Security plan, cross-cutting items 10–11)

Built 2026-11-22. Each money and security service measures itself. Prometheus on the secondary
server reads the measures every 30 s and keeps 30 days. Grafana draws them and sends alerts to
ntfy (phone).

## What is measured

The same file `src/utils/metrics.ts` is in gateway, user, payment, risk and support services; only
the service name differs.

| Metric | What it measures |
|---|---|
| `sbc_http_request_duration_seconds{service,method,route,code}` | Every request. `route` is the Express pattern (`/api/users/:id`), never the raw URL. A proxy mount gives its prefix (gateway); an unknown path gives `unmatched`; `code` is `2xx`…`5xx`. `/health` and `/metrics` are not timed. |
| `sbc_job_duration_seconds{task}`, `sbc_job_runs_total{task,result}`, `sbc_job_last_success_timestamp_seconds{task}` | Scheduled jobs, through `timeJob()`. The label is `task`, not `job`, because Prometheus keeps `job` for itself. |
| `sbc_process_*`, `sbc_nodejs_*` | The Node process: memory, CPU, event-loop lag. |
| `sbc_host_*` (gateway) | The main server's memory (MemAvailable), disk (`METRICS_DISK_PATHS`, default `/`) and load, so no node_exporter is needed there. |
| `sbc_mongo_*` (user-service) | MongoDB `serverStatus`, one call per scrape (2 s budget): `up`, WiredTiger cache used/dirty/max, connections. |

These scheduled jobs are timed:
- **payment:** payin reconciler, withdrawal status checker, payment alerts, finance
  reconciliation, payin archive;
- **user:** activity rollups, dormancy, ledger check, contacts webhook, conversion retry,
  authenticator adoption;
- **risk:** the live loops (events, withdrawals, payins, hourly).

No metric carries a member id, email, number or amount. `env` (preprod / prod) is added by
Prometheus from the path it scrapes; the services never guess it.

## How Prometheus reaches the services

```
secondary (Prometheus) ──HTTPS 9101, pinned self-signed cert, Bearer METRICS_TOKEN──▶ main nginx
   /preprod/<service> → 127.0.0.1:60xx/metrics   (only 169.58.159.177 allowed)
```

- **Not through Cloudflare:** monitoring keeps working when Cloudflare does not, and Bot Fight
  Mode cannot challenge the scraper.
- **Two checks:** nginx lets in only the secondary's IP, and each service checks the token itself
  (constant-time). Without `METRICS_TOKEN`, `/metrics` answers 404.

## Alerts (to ntfy)

`infra/metrics/make-grafana.py` writes the rules and the dashboard. Edit it, never the generated
files.

| Alert | When |
|---|---|
| Service injoignable | `up` = 0 for 3 min |
| Disque presque plein | above 85 % for 10 min |
| Mémoire presque pleine | above 90 % for 10 min |
| Erreurs serveur (5xx) | above 2 % of requests over 10 min (at least 0.05 req/s) |
| Routes argent lentes | payment withdrawal/payout/transactions/intents p95 above 5 s for 10 min |
| API lente | a service's p95 above 2 s for 15 min |
| MongoDB ne répond pas | 3 min |
| Cache MongoDB saturé | above 95 % for 15 min |
| Service saturé (boucle d'événements) | event-loop p99 lag above 0.5 s for 10 min |
| Tâche planifiée en échec | more than 2 failures in 30 min |
| Tâche de nuit non faite | dormancy, ledger check, finance reconciliation or adoption: no success for 26 h |

ntfy receives Grafana's webhook and builds the notification with its templates (`tpl=yes`): the
title, the message, a high priority while firing, and a message when the alert resolves. The same
alert repeats every 4 h while it lasts.

## Deploy (preprod)

Each step needs Sterling's OK; secrets are generated on the servers and never printed.

1. **Services:** `METRICS_TOKEN` (`openssl rand -hex 32`, one value) in gateway, user, payment,
   risk and support `.env`, then restart them with `--update-env`.
2. **Main server, nginx:**
   - the self-signed certificate (command at the top of `infra/metrics/nginx-main-metrics.conf`);
   - the vhost, enabled;
   - `nginx -t` and reload;
   - port 9101 open to the secondary only (ufw, if it is on).
3. **Secondary server, `/opt/metrics`:**
   - copy `docker-compose.yml`, `prometheus.yml` and `grafana/`;
   - write `.env` (see `.env.example`);
   - put `secrets/metrics_token` and `secrets/main-metrics.crt`, readable by uid 65534;
   - create `data/prometheus` (owner 65534) and `data/grafana` (owner 472);
   - `docker compose -p metrics up -d`. Images: `prom/prometheus:v3.16.0`, `grafana/grafana:13.3.0`.
4. **Check:**
   - Prometheus targets are all up: `curl -s 127.0.0.1:9090/api/v1/targets`;
   - Grafana shows « SBC : santé des services »;
   - a test alert reaches the phone.
5. **Prod:** the five `/prod/<service>` locations and targets, `METRICS_TOKEN` in the prod
   services.

**Preprod, deployed 2026-11-22:**
- **Alerts:** ntfy.sh, topic `sbc-alerts-<random>` generated on the secondary and never printed.
  To get the alerts on a phone:
  1. Read the topic on the server: `ssh ubuntu@169.58.159.177 'sudo grep NTFY_TOPIC /opt/metrics/.env'`.
  2. Subscribe to it in the ntfy app (server ntfy.sh).
  The topic is the only key: share it with nobody else.
- **Grafana `admin` password:** `sudo grep GRAFANA_ADMIN_PASSWORD /opt/metrics/.env` on the secondary.
- **Testing the contact point:** Grafana 13 answers 410 to the old receiver-test API. Send a
  Grafana-shaped body to the contact point's URL instead (title, message, status). ntfy.sh's answer
  shows the rendered title and priority.
- **Templates:** every value is wrapped in `{{ with $values.A }}…{{ end }}`. Grafana also renders
  the text of rules whose query returned nothing, and `humanize*` fails on that empty value.

Open Grafana through a tunnel: `ssh -L 3300:127.0.0.1:3300 ubuntu@169.58.159.177`, then
http://localhost:3300.

## Checks

- `user-service/src/scripts/check-metrics.ts` covers:
  - the token gate (404 / 401 / 200);
  - route patterns, with no raw id or path in any label;
  - `unmatched`, and that `/health` and `/metrics` are not timed;
  - the job counters;
  - the Mongo gauges against a local MongoDB.
- Smoke test, 2026-11-22, with the pinned images run locally:
  - **Prometheus:** all five targets scraped with `env` and `instance`; every rule and dashboard
    query parsed.
  - **Grafana:** the 11 rules, the dashboard and the ntfy contact point were loaded.
  - **Alert:** a failing job reached a fake ntfy with the right topic, templates and priority,
    and the resolve message followed.
  - **Bugs this caught, both fixed before the commit:** the `job` label clashed with Prometheus's
    own `job` label, so job names were lost; the metric prefix was doubled.
