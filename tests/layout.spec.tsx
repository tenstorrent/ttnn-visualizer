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

// ServerModeBanner reads the config directly; Layout no longer does.
vi.mock('../src/functions/getServerConfig', () => ({
    default: () => serverConfig,
}));

// The rail has its own spec; here only the shell it mounts into is under test.
vi.mock('../src/components/SideNavigation', () => ({
    default: () => <div data-testid={TEST_IDS.SIDE_NAVIGATION} />,
}));
vi.mock('../src/libs/ModalAwareOutlet', () => ({ ModalAwareOutlet: () => null }));
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
});

afterEach(cleanup);

describe('Layout', () => {
    it('mounts the navigation rail inside the flex shell', () => {
        renderLayout();

        expect(screen.getByTestId(TEST_IDS.SIDE_NAVIGATION)).toBeInTheDocument();
        expect(document.querySelector('.app-shell')).not.toBeNull();
    });

    // The banner sits beside the navigation rather than inside it, so restyling the
    // navigation can't take the hosted deployment's only pointer at the installable
    // build with it.
    it('renders the server mode banner under SERVER_MODE', () => {
        serverConfig.SERVER_MODE = true;

        renderLayout();

        expect(screen.getByTestId(TEST_IDS.SERVER_MODE_BANNER)).toBeInTheDocument();
    });

    it('omits the server mode banner on a local install', () => {
        renderLayout();

        expect(screen.queryByTestId(TEST_IDS.SERVER_MODE_BANNER)).not.toBeInTheDocument();
    });
});
