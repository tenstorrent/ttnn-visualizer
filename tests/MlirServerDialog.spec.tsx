// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MlirServerDialog from '../src/components/report-selection/MlirServerDialog';

const getServerConfigMock = vi.hoisted(() =>
    vi.fn(() => ({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '',
        SSH_DEFAULT_PERFORMANCE_PATH: '',
        USERNAME: 'bob',
    })),
);

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

vi.mock('../src/hooks/useMlirRemote', () => ({
    default: () => ({
        testConnection: vi.fn(),
    }),
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    getServerConfigMock.mockClear();
    getServerConfigMock.mockReturnValue({
        SSH_DEFAULT_PORT: 2222,
        SSH_DEFAULT_PROFILER_PATH: '',
        SSH_DEFAULT_PERFORMANCE_PATH: '',
        USERNAME: 'bob',
    });
});

describe('MlirServerDialog defaults', () => {
    it('seeds SSH port from getServerConfig', () => {
        render(
            <MlirServerDialog
                open
                onClose={vi.fn()}
                onAddServer={vi.fn()}
            />,
        );

        expect(screen.getByLabelText(/SSH Port/i)).toHaveValue('2222');
        expect(screen.getByLabelText('Username')).toHaveValue('bob');
    });
});
