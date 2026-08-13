// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerConfig } from '../src/definitions/ServerConfig';
import { TEST_IDS } from '../src/definitions/TestIds';
import Layout from '../src/components/Layout';
import { TestProviders } from './helpers/TestProviders';

const serverConfig: Partial<ServerConfig> = {};

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => serverConfig,
}));

// Both menus have their own specs; here only which one mounts is under test.
vi.mock('../src/components/MainNavigation', () => ({ default: () => <div data-testid='main-navigation' /> }));
vi.mock('../src/components/SideNavigation', () => ({
    default: () => <div data-testid={TEST_IDS.SIDE_NAVIGATION} />,
}));
vi.mock('../src/libs/ModalAwareOutlet', () => ({ ModalAwareOutlet: () => <div data-testid='outlet' /> }));
vi.mock('../src/components/FooterInfobar', () => ({ default: () => null }));
vi.mock('../src/components/FeedbackButton', () => ({ default: () => null }));
vi.mock('../src/components/FileStatusOverlay', () => ({ default: () => null }));
vi.mock('../src/components/mlir/MlirFileResultsOverlay', () => ({ default: () => null }));
vi.mock('../src/components/cluster/ClusterRenderer', () => ({ default: () => null }));

const renderLayout = () =>
    render(
        <TestProviders>
            <Layout />
        </TestProviders>,
    );

beforeEach(() => {
    serverConfig.SERVER_MODE = false;
    serverConfig.NEW_MENU = false;
});

afterEach(cleanup);

describe('Layout navigation style', () => {
    it('keeps the horizontal header when NEW_MENU is off', () => {
        renderLayout();

        expect(screen.getByTestId('main-navigation')).toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.SIDE_NAVIGATION)).not.toBeInTheDocument();
        expect(document.querySelector('.app-header')).not.toBeNull();
    });

    it('replaces the header with the rail when NEW_MENU is on', () => {
        serverConfig.NEW_MENU = true;

        renderLayout();

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toBeInTheDocument();
        expect(screen.queryByTestId('main-navigation')).not.toBeInTheDocument();
        // The rail carries its own logo, so leaving the header behind would duplicate it.
        expect(document.querySelector('.app-header')).toBeNull();
        expect(document.querySelector('.app-shell-sidebar')).not.toBeNull();
    });
});

describe('Server mode banner placement', () => {
    // The banner used to live inside MainNavigation, so turning NEW_MENU on removed the
    // hosted deployment's only pointer at the installable build.
    it.each([false, true])('renders under SERVER_MODE with NEW_MENU=%s', (newMenu) => {
        serverConfig.SERVER_MODE = true;
        serverConfig.NEW_MENU = newMenu;

        renderLayout();

        expect(screen.getByTestId(TEST_IDS.SERVER_MODE_BANNER)).toBeInTheDocument();
    });

    it.each([false, true])('stays absent on a local install with NEW_MENU=%s', (newMenu) => {
        serverConfig.NEW_MENU = newMenu;

        renderLayout();

        expect(screen.queryByTestId(TEST_IDS.SERVER_MODE_BANNER)).not.toBeInTheDocument();
    });
});
