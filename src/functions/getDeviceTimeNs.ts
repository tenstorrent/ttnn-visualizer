// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { TypedPerfTableRow } from '../model/PerfTable';
import isValidNumber from './isValidNumber';
import { NS_PER_US } from './math';

// `device_time` is tt-perf-report's Device Time, in µs; the charts plot durations in ns, the unit of `pm_ideal_ns`.
const getDeviceTimeNs = ({ device_time: deviceTimeUs }: Pick<TypedPerfTableRow, 'device_time'>): number | null =>
    isValidNumber(deviceTimeUs) ? deviceTimeUs * NS_PER_US : null;

export default getDeviceTimeNs;
