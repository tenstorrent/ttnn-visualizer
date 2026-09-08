// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppVersionStatus from '../src/components/AppVersionStatus';

vi.mock('@blueprintjs/core', async () => {
    const original = await vi.importActual<typeof import('@blueprintjs/core')>('@blueprintjs/core');
    return {
        ...original,
        Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
            <div data-testid='tooltip-host'>
                <div data-testid='tooltip-content'>{content}</div>
                {children}
            </div>
        ),
    };
});

const CURRENT_VERSION = '0.96.0';

afterEach(cleanup);

describe('AppVersionStatus', () => {
    it('does not offer an update when the published version matches', () => {
        render(
            <AppVersionStatus
                appVersion={CURRENT_VERSION}
                latestAppVersion={CURRENT_VERSION}
            />,
        );

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText(`v${CURRENT_VERSION}`)).toBeInTheDocument();
        expect(screen.getByTestId('tooltip-content')).toHaveTextContent('TT-NN Visualizer is up to date');
    });

    it.each([
        ['0.96.0', '0.95.1'],
        ['1.0.0', '0.99.5'],
    ])('does not offer an update when local %s is ahead of published %s', (appVersion, latestAppVersion) => {
        render(
            <AppVersionStatus
                appVersion={appVersion}
                latestAppVersion={latestAppVersion}
            />,
        );

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('links to the published release on PyPI when an update is available', () => {
        render(
            <AppVersionStatus
                appVersion={CURRENT_VERSION}
                latestAppVersion='0.97.0'
            />,
        );

        const link = screen.getByRole('link');

        expect(link).toHaveAttribute('href', 'https://pypi.org/project/ttnn-visualizer/0.97.0');
        expect(link).toHaveClass('is-outdated-one');
        expect(screen.getByTestId('tooltip-content')).toHaveTextContent('App update available: v0.97.0');
    });

    it('escalates the outdated level for a major version gap', () => {
        render(
            <AppVersionStatus
                appVersion={CURRENT_VERSION}
                latestAppVersion='1.0.0'
            />,
        );

        expect(screen.getByRole('link')).toHaveClass('is-outdated-three');
    });

    it('does not offer an update when the published version is unknown', () => {
        render(<AppVersionStatus appVersion={CURRENT_VERSION} />);

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('shows the version alone in server mode', () => {
        render(
            <AppVersionStatus
                appVersion={CURRENT_VERSION}
                latestAppVersion='1.0.0'
                isServerMode
            />,
        );

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByTestId('tooltip-host')).not.toBeInTheDocument();
        expect(screen.getByText(`v${CURRENT_VERSION}`)).toBeInTheDocument();
    });

    it('reports an unsuccessful version check without offering an update', () => {
        render(
            <AppVersionStatus
                appVersion={CURRENT_VERSION}
                latestVersionCheckFailed
            />,
        );

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByTestId('tooltip-content')).toHaveTextContent('Could not check for the latest version');
    });
});
