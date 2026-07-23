// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ProtectedRoute from '../src/components/ProtectedRoute';
import ROUTES from '../src/definitions/Routes';

const { mockUseRestoreInstance } = vi.hoisted(() => ({
    mockUseRestoreInstance: vi.fn(),
}));

vi.mock('../src/hooks/useRestoreInstance', () => ({
    default: () => mockUseRestoreInstance(),
}));

afterEach(cleanup);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ProtectedRoute', () => {
    it('shows the instance loader while restore has not finished, regardless of isLoading', () => {
        mockUseRestoreInstance.mockReturnValue({
            instance: null,
            isLoading: false,
            hasRestoredInstance: false,
        });

        render(
            <MemoryRouter
                initialEntries={[ROUTES.HOME]}
                future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
            >
                <ProtectedRoute>
                    <div data-testid='protected-child'>child</div>
                </ProtectedRoute>
            </MemoryRouter>,
        );

        expect(screen.getByText('Initializing instance...')).toBeInTheDocument();
        expect(screen.queryByTestId('protected-child')).not.toBeInTheDocument();
    });

    it('renders children once restore has finished', () => {
        mockUseRestoreInstance.mockReturnValue({
            instance: null,
            isLoading: true,
            hasRestoredInstance: true,
        });

        render(
            <MemoryRouter
                initialEntries={[ROUTES.HOME]}
                future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
            >
                <ProtectedRoute>
                    <div data-testid='protected-child'>child</div>
                </ProtectedRoute>
            </MemoryRouter>,
        );

        expect(screen.getByTestId('protected-child')).toBeInTheDocument();
        expect(screen.queryByText('Initializing instance...')).not.toBeInTheDocument();
    });
});
