<!--
SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
-->

# Local Prometheus collection

TT-NN Visualizer can expose aggregate usage counters to a Prometheus container running on the same machine. Prometheus stores those counters locally and can optionally send them to a configured remote-write endpoint. Raw event lines never leave the visualizer through this flow.

Collection is opt-in, local-install only, and disabled by default.

## Configure the opt-in

Running the configuration renderer is the explicit opt-in:

```shell
pnpm prometheus:config
```

When `~/.ttnn-visualizer/usage/collection.json` does not exist, the command creates it with local collection enabled:

```json
{
  "enabled": true
}
```

The renderer never replaces an existing config with the default opt-in. A disabled config is kept as it is and renders a configuration with no `remote_write` stanza. An invalid config is kept as it is too, and the renderer refuses to render from it: it prints the reason, exits non-zero and writes no Prometheus configuration, so an error is never mistaken for a healthy setup that collects nothing.

Only a valid enabled config is ever rewritten, and only to add a missing `machine_id` or to normalise an existing one to 32 lowercase hexadecimal characters without hyphens, so `550e8400-e29b-41d4-a716-446655440000` becomes `550e8400e29b41d4a716446655440000`. Separately, the renderer restricts any existing config file to mode `0600`, disabled and invalid ones included. Its directory is shared with the event log and is left alone.

The renderer checks its `--app-target` and `--base-path` arguments first, so a run with invalid arguments creates nothing.

This enables the local metrics endpoint and lets the Docker Prometheus retain scraped data locally. To forward those metrics to a centrally managed receiver, add its remote-write URL:

```json
{
  "enabled": true,
  "remote_write_endpoint": "https://prometheus.example/api/v1/write"
}
```

A remote-write endpoint must use HTTPS unless it is a loopback URL. Version 1 does not support URL query parameters, credentials in the URL, or a separate authentication secret.

Remote-write requests are therefore unauthenticated. Until authentication is supported, place the receiver behind network controls such as a VPN, mutual TLS, or an IP allowlist. Anyone who can reach an unprotected receiver can write arbitrary series to it.

Remote write keeps only `ttnn_visualizer_.*` metrics and removes Prometheus's `job` and `instance` target labels. Prometheus-generated scrape health series and the configured application target are not forwarded.

The renderer, or the next TT-NN Visualizer launch, adds a random `machine_id` to the file and restricts its mode to `0600`. Until one of them has run, `/api/metrics` serves nothing for an enabled config, because every sample is labelled with that ID. This identifier is unrelated to the hostname, username, IP address, or report contents. Keep it to preserve one series identity across launches.

## Start collection

Start TT-NN Visualizer on its normal backend port, `8000`, then render the Prometheus configuration if you have not already done so:

```shell
pnpm prometheus:config
```

Wheel installations can run the equivalent command directly:

```shell
ttnn-visualizer-prometheus-config \
  --output /path/to/ttnn-visualizer/docker/prometheus/prometheus.generated.yml
```

If the backend uses another port, pass the target visible from Docker:

```shell
ttnn-visualizer-prometheus-config \
  --app-target host.docker.internal:8123 \
  --output docker/prometheus/prometheus.generated.yml
```

If the visualizer uses a non-root `BASE_PATH`, pass it explicitly. The renderer reads neither `BASE_PATH` nor `PORT` from the environment:

```shell
ttnn-visualizer-prometheus-config \
  --base-path /visualizer/ \
  --output docker/prometheus/prometheus.generated.yml
```

Start Prometheus:

```shell
docker compose -f docker/prometheus/docker-compose.yml up -d
```

`host.docker.internal` reaches the host from Docker Desktop on macOS. The Compose file also supplies Docker's `host-gateway` mapping where supported.

On Linux, keep TT-NN Visualizer on its default loopback binding and use the host-network override:

```shell
ttnn-visualizer-prometheus-config \
  --app-target 127.0.0.1:8000 \
  --output docker/prometheus/prometheus.generated.yml
docker compose \
  -f docker/prometheus/docker-compose.yml \
  -f docker/prometheus/docker-compose.linux.yml \
  up -d
```

Host networking lets Prometheus reach the loopback-only backend without exposing the visualizer to the LAN. Use both Compose files for subsequent Linux `logs`, `restart`, and `down` commands.

## Verify

Confirm that the visualizer is exposing aggregates:

```shell
curl --fail http://localhost:8000/api/metrics
```

Open `http://localhost:9090/targets` and confirm that `ttnn-visualizer` is healthy. Inspect forwarding errors without exposing response bodies:

```shell
docker compose -f docker/prometheus/docker-compose.yml logs prometheus
```

The generated configuration and Prometheus data are local state. `prometheus.generated.yml` contains no credentials, is mode `0644` so the unprivileged Prometheus container can read it, and is ignored by Git at the `docker/prometheus/` path used throughout this page. It does hold your `machine_id` and any remote-write URL, so do not commit a copy written elsewhere. The TSDB uses a named Docker volume.

## Change or disable collection

After changing `collection.json`, rerun the renderer and restart Prometheus:

```shell
pnpm prometheus:config
docker compose -f docker/prometheus/docker-compose.yml restart prometheus
```

To disable forwarding, set `"enabled": false`, rerender, and restart. The disabled generated configuration has no `remote_write` stanza, and `/api/metrics` returns an empty valid exposition.

Opting out of event logging, with `USAGE_RECORDING_DISABLED=true` or the `~/.ttnn-visualizer/usage/disabled` marker, also disables `/api/metrics`: it returns `404` and serves nothing, including counts already in the log. The collection config is left unchanged, so removing the opt-out resumes collection under the same machine ID.

Deleting `collection.json` also disables collection. If it is recreated and enabled later, a new machine ID is generated. Deleting `events.log` resets the projected counters but does not delete samples already accepted by the remote Prometheus.

Stop the local Prometheus while preserving its data:

```shell
docker compose -f docker/prometheus/docker-compose.yml down
```

Remove its persistent volume as well:

```shell
docker compose -f docker/prometheus/docker-compose.yml down --volumes
```
