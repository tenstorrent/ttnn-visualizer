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

    it('disables the picker when disabled is set', () => {
        render(
            <TestProviders>
                <LocalFolderPicker
                    items={folders}
                    value={null}
                    handleSelect={vi.fn()}
                    disabled
                />
            </TestProviders>,
        );

        expect(screen.getByText('Select a report...').closest('button')).toHaveProperty('disabled', true);
    });

    it('does not delete when the confirm Alert is confirmed while loading', async () => {
        const handleDelete = vi.fn();
        const { rerender } = render(
            <TestProviders>
                <LocalFolderPicker
                    items={folders}
                    value={null}
                    handleSelect={vi.fn()}
                    handleDelete={handleDelete}
                />
            </TestProviders>,
        );

        fireEvent.click(screen.getByText('Select a report...'));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        fireEvent.click(screen.getAllByLabelText('Delete report')[0]);
        expect(screen.getAllByText(/Are you sure you want to delete/).length).toBeGreaterThan(0);

        rerender(
            <TestProviders>
                <LocalFolderPicker
                    items={folders}
                    value={null}
                    handleSelect={vi.fn()}
                    handleDelete={handleDelete}
                    loading
                />
            </TestProviders>,
        );

        // Select may close the menu (and unmount Alerts) when loading; if an Alert
        // remains, confirm must still be a no-op.
        screen.queryAllByRole('button', { name: 'Delete' }).forEach((button) => {
            fireEvent.click(button);
        });
        expect(handleDelete).not.toHaveBeenCalled();
    });

    it('opens a single confirm dialog however many folders are listed', async () => {
        render(
            <TestProviders>
                <LocalFolderPicker
                    items={folders}
                    value={null}
                    handleSelect={vi.fn()}
                    handleDelete={vi.fn()}
                />
            </TestProviders>,
        );

        fireEvent.click(screen.getByText('Select a report...'));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        fireEvent.click(screen.getAllByLabelText('Delete report')[0]);

        expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    });

    it('deletes the folder whose row was clicked', async () => {
        const handleDelete = vi.fn();
        render(
            <TestProviders>
                <LocalFolderPicker
                    items={folders}
                    value={null}
                    handleSelect={vi.fn()}
                    handleDelete={handleDelete}
                />
            </TestProviders>,
        );

        fireEvent.click(screen.getByText('Select a report...'));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        // Rows render sorted, so read the row's own label rather than assuming the items order.
        const rows = [...document.querySelectorAll('.folder-picker-menu-item')];
        const secondRowPath = rows[1].querySelector('.bp6-text-overflow-ellipsis')?.textContent;

        fireEvent.click(rows[1].querySelector<HTMLButtonElement>('[aria-label="Delete report"]')!);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(handleDelete).toHaveBeenCalledTimes(1);
        expect(`/${handleDelete.mock.calls[0][0].path}`).toBe(secondRowPath);
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
