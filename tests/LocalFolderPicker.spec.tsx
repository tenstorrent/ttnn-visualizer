// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalFolderPicker from '../src/components/report-selection/LocalFolderPicker';
import { CONFIRM_DELETE_LABEL, ManagedEntity } from '../src/definitions/ManagedEntity';
import { ReportFolder } from '../src/definitions/Reports';
import { TEST_IDS } from '../src/definitions/TestIds';
import { getDeleteActionLabel } from '../src/functions/managedEntityLabels';
import testForPortal from './helpers/testForPortal';
import { TestProviders } from './helpers/TestProviders';

const getServerConfigMock = vi.hoisted(() => vi.fn(() => ({ SERVER_MODE: false })));

afterEach(cleanup);

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue({ SERVER_MODE: false });
});

vi.mock('../src/hooks/useAPI', () => ({
    useInstance: () => ({ data: {} }),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

const WAIT_FOR_OPTIONS = { timeout: 1000 };
const SELECT_REPORT_TEXT = 'Select a report...';

const folders: ReportFolder[] = [
    { path: 'unknown-run', reportName: 'unknown-run' },
    { path: 'unlinked-run', reportName: 'unlinked-run' },
    { path: 'linked-run', reportName: 'linked-run' },
];

const deleteLabel = (folder: ReportFolder) => getDeleteActionLabel(ManagedEntity.REPORT, folder.reportName);

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

        fireEvent.click(screen.getByLabelText(deleteLabel(folders[0])));
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

        // The alert is a sibling of the Select rather than a child of its item renderer, so it
        // stays mounted when the popover closes — confirming while loading must be a no-op.
        fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

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

        fireEvent.click(screen.getByLabelText(deleteLabel(folders[0])));

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
        const secondRow = screen.getAllByTestId(TEST_IDS.FOLDER_PICKER_ROW)[1];
        const secondRowFolder = folders.find((folder) => secondRow.textContent?.includes(`/${folder.path}`))!;

        fireEvent.click(within(secondRow).getByLabelText(deleteLabel(secondRowFolder)));

        // The confirmation must name the row that was clicked, not whichever row rendered first.
        expect(screen.getByText(/Are you sure you want to delete/)).toHaveTextContent(secondRowFolder.reportName);
        fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

        expect(handleDelete).toHaveBeenCalledTimes(1);
        expect(handleDelete).toHaveBeenCalledWith(secondRowFolder);
    });

    it('offers no delete action or confirmation in server mode', async () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

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

        fireEvent.click(screen.getByText(SELECT_REPORT_TEXT));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        // The rows still render, so this is the gate being asserted rather than an empty dropdown.
        expect(screen.getAllByTestId(TEST_IDS.FOLDER_PICKER_ROW)).toHaveLength(folders.length);
        folders.forEach((folder) => expect(screen.queryByLabelText(deleteLabel(folder))).toBeNull());
        expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
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
