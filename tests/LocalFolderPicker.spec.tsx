// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalFolderPicker from '../src/components/report-selection/LocalFolderPicker';
import { CONFIRM_DELETE_LABEL, ManagedEntity } from '../src/definitions/ManagedEntity';
import { ReportFolder } from '../src/definitions/Reports';
import { ServerConfig } from '../src/definitions/ServerConfig';
import { TEST_IDS } from '../src/definitions/TestIds';
import {
    CLEAR_FILTER_QUERY_LABEL,
    LINKED_ONLY_LABEL,
    NO_LINKED_RESULTS_TEXT,
} from '../src/definitions/FolderLinkStatus';
import { getDeleteActionLabel } from '../src/functions/managedEntityLabels';
import testForPortal from './helpers/testForPortal';
import { TestProviders } from './helpers/TestProviders';
import { runsWithoutFingerprints } from './helpers/reportLinkFixtures';

const getServerConfigMock = vi.hoisted(() => vi.fn((): Partial<ServerConfig> => ({ SERVER_MODE: false })));

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
    it('preserves the supplied order when showing link badges', async () => {
        render(
            <TestProviders>
                <LocalFolderPicker
                    items={folders}
                    value={null}
                    handleSelect={vi.fn()}
                    linkedRuns={runsWithoutFingerprints('linked-run')}
                    unlinkedRuns={runsWithoutFingerprints('unlinked-run')}
                />
            </TestProviders>,
        );

        fireEvent.click(screen.getByText('Select a report...'));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        const labels = [...document.querySelectorAll('.folder-picker-menu-item .bp6-text-overflow-ellipsis')].map(
            (el) => el.textContent,
        );

        expect(labels).toEqual(['/unknown-run', '/unlinked-run', '/linked-run']);
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

        // Loading disables the Select, which closes the popover and takes the row actions with it,
        // so nothing can start a second delete — but the alert already open is the exposed half.
        expect(screen.queryByLabelText(deleteLabel(folders[0]))).not.toBeInTheDocument();

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

        const secondRow = screen.getAllByTestId(TEST_IDS.FOLDER_PICKER_ROW)[1];
        const secondRowFolder = folders[1];

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

    it('offers no delete action or confirmation in direct-report mode', async () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: false, TT_METAL_HOME: '/opt/tt-metal' });

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
                    linkedRuns={runsWithoutFingerprints()}
                    unlinkedRuns={runsWithoutFingerprints('unlinked-run')}
                />
            </TestProviders>,
        );

        fireEvent.click(screen.getByText('Select a report...'));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        const unlinkIcon = document.querySelector('.folder-picker-menu-item .bp6-icon-unlink.bp6-intent-warning');
        expect(unlinkIcon).not.toBeNull();
    });

    // A re-run written into the folder must not inherit the old run's verdict (#2069).
    it.each([
        ['the run it was linked with', 'v1:linked', 1, 0],
        ['a later run', 'v1:later', 0, 1],
    ])('badges a folder holding %s accordingly', async (_case, runFingerprint, linkedCount, unknownCount) => {
        render(
            <TestProviders>
                <LocalFolderPicker
                    items={[{ path: 'reused-run', reportName: 'reused-run', runFingerprint }]}
                    value={null}
                    handleSelect={vi.fn()}
                    linkedRuns={new Map([['reused-run', 'v1:linked']])}
                    unlinkedRuns={runsWithoutFingerprints()}
                />
            </TestProviders>,
        );

        fireEvent.click(screen.getByText('Select a report...'));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);

        expect(document.querySelectorAll('.folder-picker-menu-item .bp6-icon-link.bp6-intent-success')).toHaveLength(
            linkedCount,
        );
        expect(document.querySelectorAll('.folder-picker-menu-item .folder-link-status-unknown')).toHaveLength(
            unknownCount,
        );
    });
});

describe('LocalFolderPicker linked-only filter', () => {
    const renderPicker = (
        linkedRuns = runsWithoutFingerprints('linked-run'),
        unlinkedRuns = runsWithoutFingerprints('unlinked-run'),
        handleSelect = vi.fn(),
    ) => {
        const ui = (linked: typeof linkedRuns, unlinked: typeof unlinkedRuns) => (
            <TestProviders>
                <LocalFolderPicker
                    items={folders}
                    value={null}
                    handleSelect={handleSelect}
                    linkedRuns={linked}
                    unlinkedRuns={unlinked}
                />
            </TestProviders>
        );
        const { rerender } = render(ui(linkedRuns, unlinkedRuns));

        return {
            rerenderWith: (linked: typeof linkedRuns, unlinked: typeof unlinkedRuns) => rerender(ui(linked, unlinked)),
        };
    };

    const openPicker = async () => {
        fireEvent.click(screen.getByText(SELECT_REPORT_TEXT));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);
    };

    const getRowLabels = () =>
        [...document.querySelectorAll('.folder-picker-menu-item .bp6-text-overflow-ellipsis')].map(
            (el) => el.textContent,
        );

    const typeQuery = (query: string) =>
        fireEvent.change(screen.getByPlaceholderText('Filter...'), { target: { value: query } });

    it('has no toggle when there are no badges', async () => {
        renderPicker(runsWithoutFingerprints(), runsWithoutFingerprints());
        await openPicker();

        expect(screen.queryByTestId(TEST_IDS.FOLDER_PICKER_LINKED_ONLY_TOGGLE)).toBeNull();
    });

    it('hides unlinked and unknown rows while on, and restores the supplied order when off', async () => {
        renderPicker();
        await openPicker();

        const toggle = screen.getByTestId(TEST_IDS.FOLDER_PICKER_LINKED_ONLY_TOGGLE);
        expect(toggle).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect(getRowLabels()).toEqual(['/linked-run']), WAIT_FOR_OPTIONS);

        fireEvent.click(toggle);
        await waitFor(
            () => expect(getRowLabels()).toEqual(['/unknown-run', '/unlinked-run', '/linked-run']),
            WAIT_FOR_OPTIONS,
        );
    });

    it('combines with the text filter', async () => {
        renderPicker();
        await openPicker();

        fireEvent.click(screen.getByTestId(TEST_IDS.FOLDER_PICKER_LINKED_ONLY_TOGGLE));
        typeQuery('run');
        await waitFor(() => expect(getRowLabels()).toEqual(['/linked-run']), WAIT_FOR_OPTIONS);

        typeQuery('unknown');
        await waitFor(() => expect(screen.getByText(NO_LINKED_RESULTS_TEXT)).toBeInTheDocument(), WAIT_FOR_OPTIONS);
    });

    it('still clears the text filter', async () => {
        renderPicker();
        await openPicker();

        typeQuery('unknown');
        await waitFor(() => expect(getRowLabels()).toEqual(['/unknown-run']), WAIT_FOR_OPTIONS);

        fireEvent.click(screen.getByLabelText(CLEAR_FILTER_QUERY_LABEL));
        expect(screen.getByPlaceholderText('Filter...')).toHaveValue('');
        await waitFor(() => expect(getRowLabels()).toHaveLength(folders.length), WAIT_FOR_OPTIONS);
    });

    it('returns focus to the filter input when Enter clears the query', async () => {
        const handleSelect = vi.fn();
        renderPicker(undefined, undefined, handleSelect);
        await openPicker();

        const input = screen.getByPlaceholderText('Filter...');
        // Let Select's own autofocus on open land first, so it cannot stand in for the refocus.
        await waitFor(() => expect(input).toHaveFocus(), WAIT_FOR_OPTIONS);

        typeQuery('unknown');
        const clearButton = screen.getByLabelText(CLEAR_FILTER_QUERY_LABEL);
        clearButton.focus();
        fireEvent.keyDown(clearButton, { key: 'Enter' });
        fireEvent.keyUp(clearButton, { key: 'Enter' });

        expect(handleSelect).not.toHaveBeenCalled();
        expect(screen.queryByLabelText(CLEAR_FILTER_QUERY_LABEL)).toBeNull();
        expect(input).toHaveValue('');
        expect(input).toHaveFocus();
    });

    it('stops hiding rows once the badges go away', async () => {
        const { rerenderWith } = renderPicker();
        await openPicker();

        fireEvent.click(screen.getByTestId(TEST_IDS.FOLDER_PICKER_LINKED_ONLY_TOGGLE));
        await waitFor(() => expect(getRowLabels()).toEqual(['/linked-run']), WAIT_FOR_OPTIONS);

        rerenderWith(runsWithoutFingerprints(), runsWithoutFingerprints());
        await waitFor(() => expect(getRowLabels()).toHaveLength(folders.length), WAIT_FOR_OPTIONS);
    });

    it('comes back off when the badges return', async () => {
        const { rerenderWith } = renderPicker();
        await openPicker();

        fireEvent.click(screen.getByRole('button', { name: LINKED_ONLY_LABEL, pressed: false }));
        await waitFor(() => expect(getRowLabels()).toEqual(['/linked-run']), WAIT_FOR_OPTIONS);

        rerenderWith(runsWithoutFingerprints(), runsWithoutFingerprints());
        await waitFor(() => expect(getRowLabels()).toHaveLength(folders.length), WAIT_FOR_OPTIONS);

        rerenderWith(runsWithoutFingerprints('linked-run'), runsWithoutFingerprints('unlinked-run'));
        expect(screen.getByRole('button', { name: LINKED_ONLY_LABEL, pressed: false })).toBeTruthy();
        expect(getRowLabels()).toHaveLength(folders.length);
    });

    it('does not select a report when Enter presses the toggle', async () => {
        const handleSelect = vi.fn();
        renderPicker(undefined, undefined, handleSelect);
        await openPicker();

        const toggle = screen.getByTestId(TEST_IDS.FOLDER_PICKER_LINKED_ONLY_TOGGLE);
        fireEvent.keyDown(toggle, { key: 'Enter' });
        fireEvent.keyUp(toggle, { key: 'Enter' });

        expect(handleSelect).not.toHaveBeenCalled();
        // Enter still presses the toggle itself, and the popover stays open on the filtered list.
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(getRowLabels()).toEqual(['/linked-run']);
    });

    // Most sessions have no badges, and the filter actions still replace Blueprint's clear button.
    it('clears the query and says "No results." without badges', async () => {
        renderPicker(runsWithoutFingerprints(), runsWithoutFingerprints());
        await openPicker();

        typeQuery('matches-nothing');
        await waitFor(() => expect(screen.getByText('No results.')).toBeInTheDocument(), WAIT_FOR_OPTIONS);

        fireEvent.click(screen.getByLabelText(CLEAR_FILTER_QUERY_LABEL));
        expect(screen.getByPlaceholderText('Filter...')).toHaveValue('');
        await waitFor(() => expect(getRowLabels()).toHaveLength(folders.length), WAIT_FOR_OPTIONS);
    });

    it('says "No results." when nothing matches with the toggle off', async () => {
        renderPicker();
        await openPicker();

        typeQuery('matches-nothing');
        await waitFor(() => expect(screen.getByText('No results.')).toBeInTheDocument(), WAIT_FOR_OPTIONS);
    });

    // The filter must agree with the badge: a link to an earlier run (#2069) is not a link, and a
    // synced copy is keyed by its synced name rather than its folder.
    it('hides a folder linked only to an earlier run, and keeps a synced copy linked by its synced name', async () => {
        render(
            <TestProviders>
                <LocalFolderPicker
                    items={[
                        { path: 'reused-run', reportName: 'reused-run', runFingerprint: 'v1:later' },
                        { path: 'synced-copy', reportName: 'synced-copy', syncedName: 'remote-run' },
                    ]}
                    value={null}
                    handleSelect={vi.fn()}
                    linkedRuns={
                        new Map([
                            ['reused-run', 'v1:linked'],
                            ['remote-run', undefined],
                        ])
                    }
                    unlinkedRuns={runsWithoutFingerprints()}
                />
            </TestProviders>,
        );
        await openPicker();

        fireEvent.click(screen.getByTestId(TEST_IDS.FOLDER_PICKER_LINKED_ONLY_TOGGLE));
        await waitFor(() => expect(getRowLabels()).toEqual(['/synced-copy']), WAIT_FOR_OPTIONS);
    });
});
