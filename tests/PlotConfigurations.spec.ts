// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    CORE_COUNT_AXIS_TICK_FORMAT,
    NS_AXIS_HOVER_FORMAT,
    NS_AXIS_TICK_FORMAT,
    PERF_CHART_TRANSPARENT,
    getCoreCountAxisConfig,
    getNsAxisConfig,
    getPerfChartChrome,
} from '../src/definitions/PlotConfigurations';

/** Theme token each chrome property must resolve to, so a retint has to be a deliberate edit. */
const PERF_CHART_CHROME_DECLARATIONS = {
    '--perf-chart-line': '#{$tt-grey-4}',
    '--perf-chart-text': '#{$tt-white}',
    '--perf-chart-surface': '#{$tt-background}',
};

const PERF_CHART_CHROME_PROPERTIES = Object.keys(PERF_CHART_CHROME_DECLARATIONS);

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

describe('getPerfChartChrome', () => {
    afterEach(() => {
        PERF_CHART_CHROME_PROPERTIES.forEach((property) => document.documentElement.style.removeProperty(property));
    });

    // The stylesheet is the only source of these, so a rename there would otherwise leave every
    // chart drawing its axes and in-plot controls in an empty colour with nothing to catch it.
    // Locking the token too keeps the axes and the SCSS hover rule on one intentional colour.
    it('reads chrome custom properties that _base.scss declares against the intended tokens', () => {
        const baseStylesheet = readFileSync(resolve(process.cwd(), 'src/scss/_base.scss'), 'utf8');

        Object.entries(PERF_CHART_CHROME_DECLARATIONS).forEach(([property, token]) => {
            expect(baseStylesheet).toContain(`${property}: ${token};`);
        });
    });

    it('resolves each chrome colour from its own custom property', () => {
        document.documentElement.style.setProperty('--perf-chart-line', 'rgb(1, 1, 1)');
        document.documentElement.style.setProperty('--perf-chart-text', 'rgb(2, 2, 2)');
        document.documentElement.style.setProperty('--perf-chart-surface', 'rgb(3, 3, 3)');

        expect(getPerfChartChrome()).toEqual({
            line: 'rgb(1, 1, 1)',
            text: 'rgb(2, 2, 2)',
            surface: 'rgb(3, 3, 3)',
        });
    });

    it('keeps the transparent fill a literal, since no theme token can express it', () => {
        expect(PERF_CHART_TRANSPARENT).toBe('rgba(0, 0, 0, 0)');
    });
});
