// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ServerModeBanner from '../src/components/ServerModeBanner';
import { ServerConfig } from '../src/definitions/ServerConfig';
import { TEST_IDS } from '../src/definitions/TestIds';

/**
 * The hosted deployment's only signpost that features are missing by policy rather than
 * because the app is broken, and the one place a window-level listener is attached
 * outside `Layout`. Both are invisible in a local checkout, so nothing else would notice
 * them breaking.
 */

const getServerConfigMock = vi.hoisted(() => vi.fn((): Partial<ServerConfig> => ({ SERVER_MODE: false })));

vi.mock('../src/functions/getServerConfig', () => ({
    default: getServerConfigMock,
}));

// Just inside and just outside the component's reveal threshold.
const POINTER_NEAR_TOP = 10;
const POINTER_AWAY_FROM_TOP = 400;

afterEach(cleanup);

beforeEach(() => {
    getServerConfigMock.mockReturnValue({ SERVER_MODE: false });
});

describe('ServerModeBanner', () => {
    it('renders nothing in a local deployment', () => {
        render(<ServerModeBanner />);

        expect(screen.queryByTestId(TEST_IDS.SERVER_MODE_BANNER)).not.toBeInTheDocument();
    });

    it('attaches no pointer listener in a local deployment', () => {
        const addEventListener = vi.spyOn(window, 'addEventListener');

        render(<ServerModeBanner />);

        expect(addEventListener).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
    });

    it('starts hidden and reveals itself as the pointer approaches the top', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        render(<ServerModeBanner />);

        const banner = screen.getByTestId(TEST_IDS.SERVER_MODE_BANNER);

        expect(banner).toHaveStyle({ transform: 'translateY(-100%)' });

        fireEvent.mouseMove(window, { clientY: POINTER_NEAR_TOP });

        expect(banner).toHaveStyle({ transform: 'translateY(0)' });

        fireEvent.mouseMove(window, { clientY: POINTER_AWAY_FROM_TOP });

        expect(banner).toHaveStyle({ transform: 'translateY(-100%)' });
    });

    it('names both install routes', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        render(<ServerModeBanner />);

        expect(screen.getByRole('link', { name: 'PyPI' })).toHaveAttribute(
            'href',
            'https://pypi.org/project/ttnn-visualizer/',
        );
        expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
            'href',
            'https://github.com/tenstorrent/ttnn-visualizer',
        );
    });

    // The listener is on `window`, so an unbalanced pair outlives the component and keeps
    // firing against a discarded instance for the rest of the session.
    it('detaches the pointer listener on unmount', () => {
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });
        const removeEventListener = vi.spyOn(window, 'removeEventListener');

        const { unmount } = render(<ServerModeBanner />);

        unmount();

        expect(removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    });
});
