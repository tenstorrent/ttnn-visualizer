// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NPE from '../src/routes/NPE';
import { activeNpeOpTraceAtom } from '../src/store/app';

// Mutable holders shared with the hoisted mock factories so each case can flip
// SERVER_MODE / route params and inspect how useNpe was gated.
const h = vi.hoisted(() => ({
    serverMode: false as boolean,
    params: {} as { filepath?: string },
    useNpeArgs: [] as (string | null)[],
}));

vi.mock('../src/functions/getServerConfig', () => ({ default: () => ({ SERVER_MODE: h.serverMode }) }));
vi.mock('react-router', () => ({ useParams: () => h.params }));
vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
vi.mock('../src/hooks/useAPI', () => ({
    useNpe: (arg: string | null) => {
        h.useNpeArgs.push(arg);
        return { data: undefined, isLoading: false, error: null };
    },
    useNPETimelineFile: () => ({ data: undefined, isLoading: false, error: null }),
}));
vi.mock('../src/components/npe/NpeWindowedView', () => ({ default: () => <div data-testid='windowed-view' /> }));
vi.mock('../src/components/npe/NPEViewComponent', () => ({ default: () => <div data-testid='wholefile-view' /> }));
vi.mock('../src/components/npe/NPEFileLoader', () => ({ default: () => null }));
vi.mock('../src/components/npe/NPEDemoSelect', () => ({ default: () => null }));
vi.mock('../src/components/NPEProcessingStatus', () => ({ default: () => <div data-testid='processing-status' /> }));

const lastUseNpeArg = () => h.useNpeArgs[h.useNpeArgs.length - 1];

beforeEach(() => {
    h.serverMode = false;
    h.params = {};
    h.useNpeArgs = [];
    getDefaultStore().set(activeNpeOpTraceAtom, null);
});

afterEach(cleanup);

describe('NPE route windowed-view gate', () => {
    it('mounts the windowed view and skips useNpe for a local upload', () => {
        getDefaultStore().set(activeNpeOpTraceAtom, 'trace.json');
        render(<NPE />);

        expect(screen.getByTestId('windowed-view')).toBeDefined();
        // The whole-file fetch is skipped so it can't choke on the large payload.
        expect(lastUseNpeArg()).toBeNull();
    });

    it('keeps the whole-file path under SERVER_MODE (hosted)', () => {
        h.serverMode = true;
        getDefaultStore().set(activeNpeOpTraceAtom, 'trace.json');
        render(<NPE />);

        expect(screen.queryByTestId('windowed-view')).toBeNull();
        // Hosted still fetches the whole file by name.
        expect(lastUseNpeArg()).toBe('trace.json');
    });

    it('keeps the whole-file path when viewing a saved report by filepath', () => {
        h.params = { filepath: 'saved-report.json' };
        getDefaultStore().set(activeNpeOpTraceAtom, 'trace.json');
        render(<NPE />);

        expect(screen.queryByTestId('windowed-view')).toBeNull();
    });

    it('does not mount the windowed view when there is no uploaded file', () => {
        render(<NPE />);
        expect(screen.queryByTestId('windowed-view')).toBeNull();
    });
});
