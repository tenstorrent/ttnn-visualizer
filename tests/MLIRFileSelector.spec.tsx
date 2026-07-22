// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MLIRFileSelector from '../src/components/report-selection/MLIRFileSelector';
import { ConnectionTestStates } from '../src/definitions/ConnectionStatus';
import { MlirServerConnection } from '../src/definitions/MlirServer';
import { GraphBundle } from '../src/model/MLIRJsonModel';
import { isActivatingReportAtom, mlirFileResultsAtom, mlirServersAtom, selectedMlirServerAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({
        uploadMlirFileToServer: vi.fn(),
        testMlirServerConnection: vi.fn(),
    }),
}));

const SERVER: MlirServerConnection = {
    name: 'Test host',
    username: 'tt',
    host: 'worker-01',
    sshPort: 22,
    port: 8080,
};

const GRAPH: GraphBundle = { graphs: [{ id: 'g', nodes: [] }] };

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

it('disables MLIR inputs while an active report is being confirmed', () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER]],
                [selectedMlirServerAtom, SERVER],
                [isActivatingReportAtom, true],
                [
                    mlirFileResultsAtom,
                    [
                        {
                            filename: 'a.mlir',
                            name: 'a',
                            status: ConnectionTestStates.OK,
                            graph: GRAPH,
                            persisted: true,
                        },
                    ],
                ],
            ]}
        >
            <MLIRFileSelector />
        </TestProviders>,
    );

    expect(screen.getByRole('button', { name: /add new server/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /test host/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /edit selected server/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove selected server/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /view mlir uploads/i })).toBeDisabled();

    const fileInput = document.querySelector('.file-loader input');
    expect(fileInput).not.toBeNull();
    expect(fileInput).toBeDisabled();
});

it('enables MLIR inputs when no report activation is in progress', () => {
    render(
        <TestProviders
            initialAtomValues={[
                [mlirServersAtom, [SERVER]],
                [selectedMlirServerAtom, SERVER],
                [isActivatingReportAtom, false],
                [
                    mlirFileResultsAtom,
                    [
                        {
                            filename: 'a.mlir',
                            name: 'a',
                            status: ConnectionTestStates.OK,
                            graph: GRAPH,
                            persisted: true,
                        },
                    ],
                ],
            ]}
        >
            <MLIRFileSelector />
        </TestProviders>,
    );

    expect(screen.getByRole('button', { name: /add new server/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /test host/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /edit selected server/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /remove selected server/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /view mlir uploads/i })).toBeEnabled();

    const fileInput = document.querySelector('.file-loader input');
    expect(fileInput).not.toBeNull();
    expect(fileInput).toBeEnabled();
});
