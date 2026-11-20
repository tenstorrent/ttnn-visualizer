// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Classes, Tooltip } from '@blueprintjs/core';

export const PERF_FOOTER_ALL_DEVICES_NOTE =
    "Share of all devices' time. Each row's Total % is a share of its own device's time.";

interface PerfFooterPercentProps {
    percent: string;
    mergeDevices: boolean;
}

/**
 * A stacked table's footer Total %. While devices are unmerged each row is a share of its own
 * device, but the footer is a share of all devices, so it is marked and explained. The tooltip
 * makes its target focusable, so the explanation is reachable without a pointer.
 */
const PerfFooterPercent = ({ percent, mergeDevices }: PerfFooterPercentProps) =>
    mergeDevices ? (
        percent
    ) : (
        <Tooltip content={PERF_FOOTER_ALL_DEVICES_NOTE}>
            <span className={Classes.TOOLTIP_INDICATOR}>{percent}</span>
        </Tooltip>
    );

export default PerfFooterPercent;
