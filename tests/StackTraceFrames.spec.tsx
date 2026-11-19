// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StackTrace from '../src/components/operation-details/StackTrace';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';
import { StackSourceOrigin, StackTraceLanguage } from '../src/definitions/StackTrace';
import { TEST_IDS } from '../src/definitions/TestIds';
import { ReportSourceFiles } from '../src/model/APIData';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

const isSourceFileAvailable = vi.fn();
const readRemoteFile = vi.fn();
const mockUseReportSourceFiles = vi.fn();

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        readRemoteFile,
        isSourceFileAvailable,
        persistentState: { selectedConnection: null },
    }),
}));

vi.mock('../src/hooks/useAPI.tsx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/hooks/useAPI.tsx')>();
    return {
        ...actual,
        useReportMetadata: () => ({ data: undefined }),
        useReportSourceFiles: () => mockUseReportSourceFiles(),
    };
});

const CALL_SITE = '/m/models/resnet.py';
const CALLER = '/m/tests/infra.py';
const SOURCE_FILE_ID = 7;

// Innermost first, as the capture writes it, so frame 1 is past the collapsed preview.
const TRACE = [
    `  File "${CALL_SITE}", line 3, in run_downsample_if_req`,
    '    ds_out = ttnn.conv2d(',
    '',
    `  File "${CALLER}", line 5, in run`,
    '    self.output = self.model(',
].join('\n');

const LIBRARY = '/venv/lib/python3.10/site-packages/_pytest/python.py';

// Innermost first, as the capture writes it, so frame 1 is past the collapsed preview.
// Frame 2 is a library file the report does not hold.
const TRACE_WITH_LIBRARY_FRAME = [
    TRACE,
    `  File "${LIBRARY}", line 195, in pytest_pyfunc_call`,
    '    result = f()',
].join('\n');

const reportSourceFiles = (ids: number[], paths: string[]): { data: ReportSourceFiles } => ({
    data: { ids: new Set<number>(ids), paths: new Set<string>(paths) },
});

const FILE_CONTENTS = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'].join('\n');

const renderStackTrace = (props: Partial<ComponentProps<typeof StackTrace>> = {}) =>
    render(
        <StackTrace
            stackTrace={TRACE}
            stackTraceSourceFileId={SOURCE_FILE_ID}
            language={StackTraceLanguage.PYTHON}
            {...props}
        />,
        { wrapper: TestProviders },
    );

const frameLinks = () => screen.queryAllByTestId(TEST_IDS.STACK_TRACE_FRAME_LINK);

const openFrame = (file: string, line: number) =>
    fireEvent.click(screen.getByRole('button', { name: `"${file}", line ${line}: view source` }));

const closeViewer = () => fireEvent.click(screen.getByRole('button', { name: 'Close' }));

const highlightedLineNumber = () => document.querySelector('.highlighted-line .line-number')?.textContent;

beforeEach(() => {
    vi.clearAllMocks();
    // The report holds the call site only by the trace's source file id, and its caller by
    // path, so both routes to a link are exercised.
    mockUseReportSourceFiles.mockReturnValue(reportSourceFiles([SOURCE_FILE_ID], [CALLER]));
    isSourceFileAvailable.mockResolvedValue({ available: true, source: StackSourceOrigin.Path });
    readRemoteFile.mockImplementation((filePath: string) =>
        Promise.resolve({ data: FILE_CONTENTS, error: null, resolvedPath: filePath }),
    );
});

afterEach(cleanup);

describe('StackTrace frame links', () => {
    it("links only frame 0 in the collapsed preview, and every frame once it's expanded", () => {
        renderStackTrace({ hideSourceButton: false });

        expect(frameLinks()).toHaveLength(1);
        expect(frameLinks()[0]).toHaveTextContent(`"${CALL_SITE}", line 3`);

        fireEvent.click(screen.getByRole('button', { name: /expand/i }));

        expect(frameLinks().map((link) => link.textContent)).toEqual([`"${CALL_SITE}", line 3`, `"${CALLER}", line 5`]);
    });

    it('keeps the rest of the line around the link', () => {
        renderStackTrace();

        const line = frameLinks()[0].closest('.ttnn-line');

        expect(line?.textContent).toBe(`1  File "${CALL_SITE}", line 3, in run_downsample_if_req`);
    });

    it("opens a caller frame by its own path, without the report's source file id", async () => {
        renderStackTrace({ isInitiallyExpanded: true });

        openFrame(CALLER, 5);

        expect(await screen.findByText(CALLER)).toBeInTheDocument();
        expect(readRemoteFile).toHaveBeenCalledWith(CALLER, null);
        // Linked only because the report lists it, so it is read without an availability probe.
        expect(isSourceFileAvailable).not.toHaveBeenCalledWith(CALLER, expect.anything(), expect.anything());
    });

    it("opens frame 0 with the report's source file id, the location the Source button opens", async () => {
        renderStackTrace();

        await waitFor(() => expect(isSourceFileAvailable).toHaveBeenCalled());
        const [sourceButtonPath, , sourceButtonId] = isSourceFileAvailable.mock.calls[0];
        isSourceFileAvailable.mockClear();

        openFrame(CALL_SITE, 3);

        expect(await screen.findByText(CALL_SITE)).toBeInTheDocument();
        expect([sourceButtonPath, sourceButtonId]).toEqual([CALL_SITE, SOURCE_FILE_ID]);
        expect(readRemoteFile).toHaveBeenCalledWith(sourceButtonPath, sourceButtonId);
    });

    it("highlights the clicked frame's line in the source viewer", async () => {
        renderStackTrace({ isInitiallyExpanded: true });

        openFrame(CALLER, 5);

        await waitFor(() => expect(highlightedLineNumber()).toBe('5'));
    });

    it('opens the viewer on the read error when a listed file cannot be read', async () => {
        readRemoteFile.mockResolvedValue({ data: null, error: 'Source file not found', resolvedPath: null });
        renderStackTrace({ isInitiallyExpanded: true });

        openFrame(CALLER, 5);

        expect(await screen.findByText('Source file not found')).toBeInTheDocument();
        expect(readRemoteFile).toHaveBeenCalledWith(CALLER, null);
    });

    it('records a source file drill-down when a frame opens', async () => {
        renderStackTrace({ isInitiallyExpanded: true });

        openFrame(CALLER, 5);

        await waitFor(() =>
            expect(recordEvent).toHaveBeenCalledWith({
                event: EventLogEvent.DRILLDOWN_OPENED,
                details: { drilldown_target: DrilldownTarget.SOURCE_FILE },
            }),
        );
    });

    it('links only frames whose file the report holds', () => {
        renderStackTrace({ stackTrace: TRACE_WITH_LIBRARY_FRAME, isInitiallyExpanded: true });

        expect(frameLinks().map((link) => link.textContent)).toEqual([`"${CALL_SITE}", line 3`, `"${CALLER}", line 5`]);
        expect(screen.getByText(LIBRARY, { exact: false })).toBeInTheDocument();
    });

    it("links frame 0 by the report's source file id, but no other frame", () => {
        mockUseReportSourceFiles.mockReturnValue(reportSourceFiles([SOURCE_FILE_ID], []));
        renderStackTrace({ isInitiallyExpanded: true });

        expect(frameLinks().map((link) => link.textContent)).toEqual([`"${CALL_SITE}", line 3`]);
    });

    it('links no frame until the report says which files it holds', () => {
        mockUseReportSourceFiles.mockReturnValue({ data: undefined });
        renderStackTrace({ isInitiallyExpanded: true });

        expect(frameLinks()).toHaveLength(0);
        expect(screen.getByText(CALLER, { exact: false })).toBeInTheDocument();
    });

    it('renders each link as a focusable button named by the text it shows', () => {
        renderStackTrace();
        const link = screen.getByRole('button', { name: `"${CALL_SITE}", line 3: view source` });

        link.focus();

        expect(link).toHaveFocus();
        expect(link).toHaveAttribute('type', 'button');
        expect(link.textContent).toBe(`"${CALL_SITE}", line 3`);
    });

    it('reopens a frame from its first read', async () => {
        renderStackTrace({ isInitiallyExpanded: true });

        openFrame(CALLER, 5);
        expect(await screen.findByText(CALLER)).toBeInTheDocument();
        closeViewer();
        openFrame(CALLER, 5);

        await waitFor(() => expect(highlightedLineNumber()).toBe('5'));
        expect(readRemoteFile).toHaveBeenCalledTimes(1);
    });

    it('reads the newly clicked frame after another was opened', async () => {
        renderStackTrace({ isInitiallyExpanded: true });

        openFrame(CALLER, 5);
        expect(await screen.findByText(CALLER)).toBeInTheDocument();
        closeViewer();
        openFrame(CALL_SITE, 3);

        await waitFor(() => expect(readRemoteFile).toHaveBeenLastCalledWith(CALL_SITE, SOURCE_FILE_ID));
        await waitFor(() => expect(highlightedLineNumber()).toBe('3'));
    });

    it('forgets an opened frame when the trace it was opened in is replaced', async () => {
        const nextSourceFileId = SOURCE_FILE_ID + 1;
        mockUseReportSourceFiles.mockReturnValue(reportSourceFiles([SOURCE_FILE_ID, nextSourceFileId], [CALLER]));
        const { rerender } = renderStackTrace();

        openFrame(CALL_SITE, 3);
        expect(await screen.findByText(CALL_SITE)).toBeInTheDocument();
        closeViewer();
        readRemoteFile.mockClear();

        // Another operation called from the same line, as the details page swaps it in
        // without remounting: same frame, another source file id.
        rerender(
            <StackTrace
                stackTrace={TRACE}
                stackTraceSourceFileId={nextSourceFileId}
                language={StackTraceLanguage.PYTHON}
            />,
        );

        expect(readRemoteFile).not.toHaveBeenCalled();

        openFrame(CALL_SITE, 3);

        await waitFor(() => expect(readRemoteFile).toHaveBeenCalledWith(CALL_SITE, nextSourceFileId));
        await waitFor(() => expect(highlightedLineNumber()).toBe('3'));
    });

    it('escapes markup in the trace, on plain lines and either side of a link', () => {
        renderStackTrace({
            stackTrace: `  File "${CALLER}", line 5, in <img src=x>\n<b>boom</b>`,
            isInitiallyExpanded: true,
        });

        expect(frameLinks()).toHaveLength(1);
        expect(document.querySelector('code img')).toBeNull();
        expect(document.querySelector('code b')).toBeNull();
        expect(screen.getByText('<b>boom</b>', { exact: false })).toBeInTheDocument();
    });

    it('links nothing where the Source button is hidden', () => {
        renderStackTrace({ hideSourceButton: true, isInitiallyExpanded: true });

        expect(frameLinks()).toHaveLength(0);
        expect(screen.getByText(CALLER, { exact: false })).toBeInTheDocument();
    });

    it('links nothing in a trace with no frames', () => {
        renderStackTrace({ stackTrace: '#0 0x7f in ttnn::run()\n#1 0x80 in main()', isInitiallyExpanded: true });

        expect(frameLinks()).toHaveLength(0);
    });
});
