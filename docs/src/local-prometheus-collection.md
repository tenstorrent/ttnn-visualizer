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

When `~/.ttnn-visualizer/app/collection.json` does not exist, the command creates it with local collection enabled:

```json
{
  "enabled": true
}
```

An existing config is never overwritten, including one that is disabled or invalid.

This enables the local metrics endpoint and lets the Docker Prometheus retain scraped data locally. To forward those metrics to a centrally managed receiver, add its remote-write URL:

```json
{
  "enabled": true,
  "remote_write_endpoint": "https://prometheus.example/api/v1/write"
}
```

A remote-write endpoint must use HTTPS unless it is a loopback URL. Version 1 does not support credentials in the URL or a separate authentication secret.

On the first successful read, TT-NN Visualizer adds a random `machine_id` to the file and restricts its mode to `0600`. This identifier is unrelated to the hostname, username, IP address, or report contents. Keep it to preserve one series identity across launches.

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

The generated configuration and Prometheus data are local state. `prometheus.generated.yml` is ignored by Git, and the TSDB uses a named Docker volume.

## Change or disable collection

After changing `collection.json`, rerun the renderer and restart Prometheus:

```shell
pnpm prometheus:config
docker compose -f docker/prometheus/docker-compose.yml restart prometheus
```

To disable forwarding, set `"enabled": false`, rerender, and restart. The disabled generated configuration has no `remote_write` stanza, and `/api/metrics` returns an empty valid exposition.

Deleting `collection.json` also disables collection. If it is recreated and enabled later, a new machine ID is generated. Deleting `events.log` resets the projected counters but does not delete samples already accepted by the remote Prometheus.

Stop the local Prometheus while preserving its data:

```shell
docker compose -f docker/prometheus/docker-compose.yml down
```

Remove its persistent volume as well:

```shell
docker compose -f docker/prometheus/docker-compose.yml down --volumes
```
