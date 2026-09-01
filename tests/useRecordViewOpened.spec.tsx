// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { type Location, MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ROUTES from '../src/definitions/Routes';
import { UsageView } from '../src/definitions/UsageEvent';
import useRecordViewOpened from '../src/hooks/useRecordViewOpened';

const { recordViewOpened } = vi.hoisted(() => ({ recordViewOpened: vi.fn() }));

vi.mock('../src/functions/viewUsage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/functions/viewUsage')>();
    return { ...actual, recordViewOpened };
});

function NavigationHarness() {
    useRecordViewOpened();

    const location = useLocation();
    const navigate = useNavigate();
    const background = location.state?.background as Location | undefined;

    return (
        <>
            <button
                type='button'
                onClick={() => navigate(ROUTES.TENSORS)}
            >
                Open tensors
            </button>
            <button
                type='button'
                onClick={() => navigate(`${ROUTES.OPERATIONS}/2`)}
            >
                Open operation 2
            </button>
            <button
                type='button'
                onClick={() => navigate(`${ROUTES.GRAPHTREE}/2`)}
            >
                Open graph operation 2
            </button>
            <button
                type='button'
                onClick={() => navigate(ROUTES.CLUSTER, { state: { background: location } })}
            >
                Open topology
            </button>
            <button
                type='button'
                onClick={() => navigate(-1)}
            >
                Close topology
            </button>
            <button
                type='button'
                onClick={() => navigate(`${background?.pathname ?? ROUTES.OPERATIONS}?filter=changed`)}
            >
                Open changed background
            </button>
            <button
                type='button'
                onClick={() => navigate(`${location.pathname}?filter=active`)}
            >
                Change query
            </button>
        </>
    );
}

const renderRecorder = (initialEntry: string) =>
    render(
        <StrictMode>
            <MemoryRouter initialEntries={[initialEntry]}>
                <NavigationHarness />
            </MemoryRouter>
        </StrictMode>,
    );

describe('useRecordViewOpened', () => {
    beforeEach(() => {
        recordViewOpened.mockClear();
    });

    afterEach(() => {
        cleanup();
    });

    it('records the initial view once under StrictMode', () => {
        renderRecorder(ROUTES.OPERATIONS);

        expect(recordViewOpened).toHaveBeenCalledTimes(1);
        expect(recordViewOpened).toHaveBeenCalledWith(UsageView.OPERATIONS);
    });

    it('records a parameter change even when the view is unchanged', () => {
        renderRecorder(`${ROUTES.OPERATIONS}/1`);
        recordViewOpened.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Open operation 2' }));

        expect(recordViewOpened).toHaveBeenCalledTimes(1);
        expect(recordViewOpened).toHaveBeenCalledWith(UsageView.OPERATION_DETAILS);
    });

    it('records graph parameter changes as graph views', () => {
        renderRecorder(`${ROUTES.GRAPHTREE}/1`);
        recordViewOpened.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Open graph operation 2' }));

        expect(recordViewOpened).toHaveBeenCalledTimes(1);
        expect(recordViewOpened).toHaveBeenCalledWith(UsageView.GRAPH);
    });

    it('records every view in a sequence of static and parameterised navigations', () => {
        renderRecorder(ROUTES.OPERATIONS);
        recordViewOpened.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Open tensors' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open operation 2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open graph operation 2' }));

        expect(recordViewOpened.mock.calls).toEqual([
            [UsageView.TENSORS],
            [UsageView.OPERATION_DETAILS],
            [UsageView.GRAPH],
        ]);
    });

    it('records each topology open but never reopens its background on close', () => {
        renderRecorder(ROUTES.OPERATIONS);
        recordViewOpened.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Open topology' }));

        expect(recordViewOpened).toHaveBeenCalledTimes(1);
        expect(recordViewOpened).toHaveBeenCalledWith(UsageView.TOPOLOGY);

        recordViewOpened.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Close topology' }));

        expect(recordViewOpened).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Open topology' }));

        expect(recordViewOpened).toHaveBeenCalledTimes(1);
        expect(recordViewOpened).toHaveBeenCalledWith(UsageView.TOPOLOGY);

        recordViewOpened.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Close topology' }));

        expect(recordViewOpened).not.toHaveBeenCalled();
    });

    it('does not count a topology pathname which renders no overlay', () => {
        renderRecorder(ROUTES.CLUSTER);

        expect(recordViewOpened).not.toHaveBeenCalled();
    });

    it('does not mistake a new background-path entry for closing the topology modal', () => {
        renderRecorder(ROUTES.OPERATIONS);
        fireEvent.click(screen.getByRole('button', { name: 'Open topology' }));
        recordViewOpened.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Open changed background' }));

        expect(recordViewOpened).toHaveBeenCalledTimes(1);
        expect(recordViewOpened).toHaveBeenCalledWith(UsageView.OPERATIONS);
    });

    it('does not treat query-only navigation as opening another view', () => {
        renderRecorder(ROUTES.OPERATIONS);
        recordViewOpened.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Change query' }));

        expect(recordViewOpened).not.toHaveBeenCalled();
    });
});
