// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MlirJsonFileLoader from '../src/components/mlir/MlirJsonFileLoader';
import { ReportKind, ReportLoadFailureReason } from '../src/definitions/EventLogEvent';
import { MlirServerConnection } from '../src/model/MlirServer';

const LIMIT_MESSAGE = 'Selected upload exceeds the 1 GiB request limit.';
const SERVER: MlirServerConnection = { name: 'mlir', username: 'user', host: 'mlir-host', sshPort: 22, port: 8080 };

const { getUploadSizeLimitError, recordReportLoadFailed, uploadMlirFileToServer } = vi.hoisted(() => ({
    getUploadSizeLimitError: vi.fn(),
    recordReportLoadFailed: vi.fn(),
    uploadMlirFileToServer: vi.fn(),
}));

vi.mock('../src/hooks/useMlirRemote', () => ({ default: () => ({ uploadMlirFileToServer }) }));

vi.mock('../src/functions/reportLoadEvents', async (importOriginal) => {
    const { reportLoadEventsSpiesMock } = await import('./helpers/mockReportLoadEvents');

    return reportLoadEventsSpiesMock(importOriginal, vi.fn(), recordReportLoadFailed);
});

vi.mock('../src/functions/getUploadSizeLimitError', () => ({ default: getUploadSizeLimitError }));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const selectFiles = (server: MlirServerConnection | null, files: File[]) => {
    const { container } = render(<MlirJsonFileLoader server={server} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });

    return container;
};

describe('MlirJsonFileLoader upload size limit', () => {
    it('rejects an oversized server batch before uploading it', async () => {
        getUploadSizeLimitError.mockReturnValueOnce(LIMIT_MESSAGE);

        const container = selectFiles(SERVER, [new File(['x'], 'a.mlir'), new File(['y'], 'b.mlir')]);

        await waitFor(() => expect(container.textContent).toContain(LIMIT_MESSAGE));
        expect(uploadMlirFileToServer).not.toHaveBeenCalled();
        expect(recordReportLoadFailed).toHaveBeenCalledTimes(2);
        expect(recordReportLoadFailed).toHaveBeenCalledWith(ReportKind.MLIR, ReportLoadFailureReason.TOO_LARGE);
    });

    it('does not apply the request limit to JSON parsed in the browser', async () => {
        getUploadSizeLimitError.mockReturnValue(LIMIT_MESSAGE);

        const container = selectFiles(null, [new File(['{}'], 'graph.json')]);

        await waitFor(() => expect(container.textContent).not.toContain(LIMIT_MESSAGE));
        expect(getUploadSizeLimitError).not.toHaveBeenCalled();
        expect(recordReportLoadFailed).not.toHaveBeenCalledWith(ReportKind.MLIR, ReportLoadFailureReason.TOO_LARGE);
    });
});
