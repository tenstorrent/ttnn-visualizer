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
import statistics
import sys

import orjson
import zstd

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
