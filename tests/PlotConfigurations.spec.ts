// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    NS_AXIS_HOVER_FORMAT,
    NS_AXIS_TICK_FORMAT,
    getNsAxisConfig,
} from '../src/definitions/PlotConfigurations';

describe('getNsAxisConfig', () => {
    it('uses thousands-separated integer ticks and significant-figure hover by default', () => {
        const axis = getNsAxisConfig('Time (ns)');

        expect(axis).toEqual({
            title: { text: 'Time (ns)' },
            tickformat: ',d',
            hoverformat: ',.2r',
        });
        // Lock the named constants to the intentional literals so renaming alone cannot drift UX.
        expect(NS_AXIS_TICK_FORMAT).toBe(',d');
        expect(NS_AXIS_HOVER_FORMAT).toBe(',.2r');
    });

    it('applies overrides while keeping the title when not overridden', () => {
        const axis = getNsAxisConfig('Device Kernel Duration (ns)', {
            range: [0, 1_000_000],
            tickformat: 'e',
            tickvals: [0, 500_000, 1_000_000],
        });

        expect(axis.title).toEqual({ text: 'Device Kernel Duration (ns)' });
        expect(axis.range).toEqual([0, 1_000_000]);
        expect(axis.tickformat).toBe('e');
        expect(axis.tickvals).toEqual([0, 500_000, 1_000_000]);
        expect(axis.hoverformat).toBe(',.2r');
    });
});
