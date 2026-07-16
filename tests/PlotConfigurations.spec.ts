// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    CORE_COUNT_AXIS_TICK_FORMAT,
    NS_AXIS_HOVER_FORMAT,
    NS_AXIS_TICK_FORMAT,
    getCoreCountAxisConfig,
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

    it('allows title override without dropping ns format defaults', () => {
        const axis = getNsAxisConfig('A', { title: { text: 'B' } });

        expect(axis.title).toEqual({ text: 'B' });
        expect(axis.tickformat).toBe(NS_AXIS_TICK_FORMAT);
        expect(axis.hoverformat).toBe(NS_AXIS_HOVER_FORMAT);
    });
});

describe('getCoreCountAxisConfig', () => {
    it('uses plain integer ticks (not ns thousands separators) and a max-cores range', () => {
        const axis = getCoreCountAxisConfig(64);

        expect(axis).toEqual({
            title: { text: 'Core Count' },
            tickformat: 'd',
            hoverformat: NS_AXIS_HOVER_FORMAT,
            range: [0, 64],
        });
        expect(CORE_COUNT_AXIS_TICK_FORMAT).toBe('d');
        expect(CORE_COUNT_AXIS_TICK_FORMAT).not.toBe(NS_AXIS_TICK_FORMAT);
    });
});
