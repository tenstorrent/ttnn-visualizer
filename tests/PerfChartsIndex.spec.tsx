// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import PerfChartsIndex from '../src/components/performance/PerfChartsIndex';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import ROUTES from '../src/definitions/Routes';

afterEach(cleanup);

const entries = [
    { id: PerfChartId.OpCountVsRuntime, label: 'Operation Count vs Device Time' },
    { id: PerfChartId.CoreCountKernelRuntime, label: 'Core Count + Device Kernel Runtime' },
];

function openMenu() {
    fireEvent.click(screen.getByRole('button'));
}

describe('PerfChartsIndex', () => {
    it('renders nothing when there are no entries', () => {
        const { container } = render(
            <PerfChartsIndex
                entries={[]}
                activeId={null}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('shows the active entry label on the trigger button', () => {
        render(
            <PerfChartsIndex
                entries={entries}
                activeId={PerfChartId.CoreCountKernelRuntime}
            />,
        );

        const trigger = screen.getByRole('button');
        expect(trigger.textContent).toContain(entries[1].label);
    });

    it('renders menu items with performance route hashes when opened', () => {
        render(
            <PerfChartsIndex
                entries={entries}
                activeId={PerfChartId.OpCountVsRuntime}
            />,
        );

        openMenu();

        expect(screen.getByRole('menuitem', { name: entries[0].label })).toHaveAttribute(
            'href',
            `${ROUTES.PERFORMANCE}#${PerfChartId.OpCountVsRuntime}`,
        );
        expect(screen.getByRole('menuitem', { name: entries[1].label })).toHaveAttribute(
            'href',
            `${ROUTES.PERFORMANCE}#${PerfChartId.CoreCountKernelRuntime}`,
        );
    });

    it('marks the active entry as active in the menu', () => {
        render(
            <PerfChartsIndex
                entries={entries}
                activeId={PerfChartId.CoreCountKernelRuntime}
            />,
        );

        openMenu();

        const activeItem = screen.getByRole('menuitem', { name: entries[1].label });
        const inactiveItem = screen.getByRole('menuitem', { name: entries[0].label });

        expect(activeItem.className).toContain('bp6-active');
        expect(inactiveItem.className).not.toContain('bp6-active');
    });
});
