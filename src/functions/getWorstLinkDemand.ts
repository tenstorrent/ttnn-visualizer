// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { LinkUtilization, NPE_LINK } from '../model/NPEModel';

// Worst-link demand for a timeline heat-bar cell. The visited windowed step
// carries full link_demand; non-visited steps only have the per-step scalar
// (#861). Returns the max demand across the (already NOC-filtered) rows, the
// scalar when the window is absent, or -1 when idle/unknown — the last case also
// guards `Math.max(-1, ...[])` from returning -Infinity on an empty row set.
export default function getWorstLinkDemand(links: LinkUtilization[], maxLinkDemand: number | null | undefined): number {
    return links.length ? Math.max(-1, ...links.map((linkData) => linkData[NPE_LINK.DEMAND])) : (maxLinkDemand ?? -1);
}
