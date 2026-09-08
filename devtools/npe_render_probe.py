# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
"""Profile the render-relevant per-timestep shape of an NPE report.

For the windowed renderer, per-scrub DOM cost scales with:
  - D = len(timestep.link_demand)  -> one <button> + SVG tile each (post chip/noc filter)
  - A = len(timestep.active_transfers) -> RouteOriginsRenderer each
This prints the distribution of both plus the busiest step so we can reason
about the real bottleneck.
"""

import os
import statistics
import sys

import orjson
import zstd
from ttnn_visualizer.utils import str_to_bool


def _server_mode_enabled() -> bool:
    # Through the app's own helper so this refusal can't recognise a spelling the app
    # doesn't, or miss one it does.
    return str_to_bool(os.getenv("SERVER_MODE", "false"))


# Local-only developer tool: it opens an arbitrary caller-supplied report path,
# which is a legitimate CLI arg on an engineer's own machine but must never run
# in the hosted/multi-user deployment. Refuse under SERVER_MODE, mirroring the
# app's @local_only boundary.
if _server_mode_enabled():
    sys.exit(
        "npe_render_probe is a local-only dev tool; it refuses to run under SERVER_MODE."
    )

if len(sys.argv) < 2:
    sys.exit("usage: python devtools/npe_render_probe.py <report.(npeviz.)zst>")

path = sys.argv[1]
raw = zstd.uncompress(open(path, "rb").read())
print(f"decompressed bytes: {len(raw):,}")
obj = orjson.loads(raw)

steps = obj["timestep_data"]
n = len(steps)
transfers = obj.get("noc_transfers", [])
print(f"n_timesteps: {n:,}")
print(f"noc_transfers (total, whole file): {len(transfers):,}")

A = [len(s.get("active_transfers", [])) for s in steps]
D = [len(s.get("link_demand", [])) for s in steps]


def dist(name, xs):
    xs_sorted = sorted(xs)
    p = lambda q: xs_sorted[min(len(xs_sorted) - 1, int(q * len(xs_sorted)))]
    print(
        f"{name}: max={max(xs)} p99={p(0.99)} p95={p(0.95)} p50={p(0.50)} "
        f"mean={statistics.mean(xs):.1f} sum={sum(xs):,}"
    )


dist("A active_transfers", A)
dist("D link_demand", D)

busy = max(range(n), key=lambda i: D[i])
s = steps[busy]
print(f"\nbusiest-by-D step t={busy}: D={D[busy]} A={A[busy]}")

# How many distinct route.links would a full-transfer highlight touch at the busy step?
route_links = 0
active_ids = set(s.get("active_transfers", []))
by_id = {t["id"]: t for t in transfers}
for tid in active_ids:
    tr = by_id.get(tid)
    if tr:
        for r in tr.get("route", []):
            route_links += len(r.get("links", []))
print(f"busy step: total route.links across active transfers = {route_links}")

# chips count (multiplies the grid render)
print(f"chips: {len(obj.get('chips', {}))}")
print(f"zones (root): {len(obj.get('zones', []))}")
