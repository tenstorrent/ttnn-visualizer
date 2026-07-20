// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LocalFolderPicker from '../src/components/report-selection/LocalFolderPicker';
import { ReportFolder } from '../src/definitions/Reports';
import testForPortal from './helpers/testForPortal';
import { TestProviders } from './helpers/TestProviders';

afterEach(cleanup);

vi.mock('../src/hooks/useAPI', () => ({
    useInstance: () => ({ data: {} }),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ SERVER_MODE: false }),
}));

const WAIT_FOR_OPTIONS = { timeout: 1000 };

const folders: ReportFolder[] = [
    { path: 'unknown-run', reportName: 'unknown-run' },
    { path: 'unlinked-run', reportName: 'unlinked-run' },
    { path: 'linked-run', reportName: 'linked-run' },
];

describe('LocalFolderPicker link badges', () => {
    it('sorts linked first, unknown middle, unlinked last', async () => {
        render(
            <TestProviders>
                <LocalFolderPicker
                    items={folders}
                    value={null}
                    handleSelect={vi.fn()}
                    linkedIds={new Set(['linked-run'])}
                    unlinkedIds={new Set(['unlinked-run'])}
                />
            </TestProviders>,
        );

        fireEvent.click(screen.getByText('Select a report...'));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        const labels = [...document.querySelectorAll('.folder-picker-menu-item .bp6-text-overflow-ellipsis')].map(
            (el) => el.textContent,
        );

        expect(labels).toEqual(['/linked-run', '/unknown-run', '/unlinked-run']);
    });

    it('shows a warning unlink icon on unlinked folders', async () => {
        render(
            <TestProviders>
                <LocalFolderPicker
                    items={[{ path: 'unlinked-run', reportName: 'unlinked-run' }]}
                    value={null}
                    handleSelect={vi.fn()}
                    linkedIds={new Set()}
                    unlinkedIds={new Set(['unlinked-run'])}
                />
            </TestProviders>,
        );

        fireEvent.click(screen.getByText('Select a report...'));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        const unlinkIcon = document.querySelector('.folder-picker-menu-item .bp6-icon-unlink.bp6-intent-warning');
        expect(unlinkIcon).not.toBeNull();
    });
});
