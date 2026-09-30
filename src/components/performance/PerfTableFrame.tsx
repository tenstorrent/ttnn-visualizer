// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReactNode, TableHTMLAttributes } from 'react';

interface PerfTableFrameProps extends TableHTMLAttributes<HTMLTableElement> {
    children: ReactNode;
}

// The scroll box the sticky header pins to. Every perf table, skeleton included, renders
// through here so the loaded and loading states share one box and nothing jumps on swap.
// Focusable and labelled because browsers other than Firefox won't let a keyboard reach a
// scroll container otherwise, and the sticky header's buttons can't scroll the body.
function PerfTableFrame({ children, ...tableProps }: PerfTableFrameProps) {
    return (
        <div
            className='perf-table-scroll'
            role='region'
            aria-label='Performance table'
            // A scroll container must take focus to be keyboard-scrollable (WCAG 2.1.1).
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
        >
            <table
                className='perf-table monospace'
                {...tableProps}
            >
                {children}
            </table>
        </div>
    );
}

export default PerfTableFrame;
