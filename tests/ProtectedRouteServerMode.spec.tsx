// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The hosted rail omits every item flagged `hiddenInServerMode`, and `ProtectedRoute`
 * refuses the same routes by URL. Both read the flag from `NAVIGATION_ITEMS`, so a newly
 * flagged item is covered here without a page-level guard of its own. #2101
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import ProtectedRoute from '../src/components/ProtectedRoute';
import { NAVIGATION_ITEMS } from '../src/definitions/NavigationItems';
import ROUTES from '../src/definitions/Routes';
import { ServerConfig } from '../src/definitions/ServerConfig';

const getServerConfigMock = vi.hoisted(() => vi.fn((): Partial<ServerConfig> => ({ SERVER_MODE: false })));

vi.mock('../src/functions/getServerConfig', () => ({ default: getServerConfigMock }));
vi.mock('../src/hooks/useRestoreInstance', () => ({
    default: () => ({ instance: null, isLoading: false, hasRestoredInstance: true }),
}));

const HIDDEN_ROUTES = NAVIGATION_ITEMS.filter((item) => item.hiddenInServerMode).map((item) => item.route);

const CurrentPath = () => <p>{useLocation().pathname}</p>;

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <ProtectedRoute>
                <CurrentPath />
            </ProtectedRoute>
        </MemoryRouter>,
    );

afterEach(cleanup);
beforeEach(() => getServerConfigMock.mockReturnValue({ SERVER_MODE: false }));

describe('ProtectedRoute in server mode', () => {
    // Catches the derivation collapsing to nothing, which every `it.each` below would pass on.
    it('has hidden routes to guard', () => {
        expect(HIDDEN_ROUTES).toEqual(expect.arrayContaining([ROUTES.MLIR, ROUTES.MCP]));
    });

    it.each(HIDDEN_ROUTES)('sends a direct visit to %s to Home', (route) => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        renderAt(route);

        expect(screen.getByText(ROUTES.HOME)).toBeInTheDocument();
    });

    // MLIR is mounted at `/mlir/:filepath?`, so an exact pathname lookup would let this through.
    it('sends a nested hidden route to Home', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        renderAt(`${ROUTES.MLIR}/model.json`);

        expect(screen.getByText(ROUTES.HOME)).toBeInTheDocument();
    });

    it('leaves routes the rail still offers alone', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        renderAt(ROUTES.NPE);

        expect(screen.getByText(ROUTES.NPE)).toBeInTheDocument();
    });

    it.each(HIDDEN_ROUTES)('lets a local run stay on %s', (route) => {
        renderAt(route);

        expect(screen.getByText(route)).toBeInTheDocument();
    });
});
