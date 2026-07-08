// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
//
// Shared Plot mock for chart click tests. Import named helpers from this module only —
// do not add a separate side-effect `import './mocks/plotComponent'` (triggers import/no-duplicates).
// Vitest hoists `vi.mock` here when the module is loaded via the named import.

import React from 'react';
import { PlotMouseEvent } from 'plotly.js';
import { vi } from 'vitest';

const plotState = vi.hoisted(() => ({
    latest: null as Record<string, unknown> | null,
    instances: [] as Record<string, unknown>[],
}));

vi.mock('../../src/libs/PlotComponent', () => ({
    default: (props: Record<string, unknown>) => {
        plotState.latest = props;
        plotState.instances.push(props);
        return React.createElement('div', { 'data-testid': 'mock-plot' });
    },
}));

export function resetPlotPropsCapture() {
    plotState.latest = null;
    plotState.instances = [];
}

export function getLatestPlotOnClick(): ((event: Readonly<PlotMouseEvent>) => void) | undefined {
    return plotState.latest?.onClick as ((event: Readonly<PlotMouseEvent>) => void) | undefined;
}

export function getPlotInstances(): Record<string, unknown>[] {
    return plotState.instances;
}

export function firePlotClick(event: Readonly<PlotMouseEvent>) {
    const onClick = getLatestPlotOnClick();
    if (!onClick) {
        throw new Error('Plot onClick handler is not set');
    }

    onClick(event);
}
