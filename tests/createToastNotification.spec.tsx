// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { ReactElement } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { Id, ToastContent, ToastOptions } from 'react-toastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import createToastNotification, { createToast, dismissToast } from '../src/functions/createToastNotification';
import { ToastType } from '../src/definitions/ToastType';
import { TEST_IDS } from '../src/definitions/TestIds';
import useBufferFocus from '../src/hooks/useBufferFocus';
import { activeToastAtom } from '../src/store/app';

// The wrapper's whole job is what it hands `react-toastify`, so the spec asserts on the
// calls rather than on rendered output -- no `<ToastContainer>` is mounted here.
const { dismiss, toastFn, toastSuccess } = vi.hoisted(() => ({
    dismiss: vi.fn(),
    toastFn: vi.fn((_content: ToastContent, _options?: ToastOptions): Id => 'toast-id'),
    toastSuccess: vi.fn((_content: ToastContent, _options?: ToastOptions): Id => 'success-id'),
}));

vi.mock('react-toastify', () => ({
    toast: Object.assign(toastFn, {
        dismiss,
        success: toastSuccess,
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    }),
}));

const lastToastContent = () => render(toastFn.mock.calls.at(-1)![0] as ReactElement);

beforeEach(() => {
    vi.clearAllMocks();
    getDefaultStore().set(activeToastAtom, null);
});

describe('createToastNotification', () => {
    it('hands over the shared file-change template and returns the toast id', () => {
        expect(createToastNotification('MLIR', 'model.json')).toBe('toast-id');

        const { container } = lastToastContent();

        expect(container).toHaveTextContent('MLIR');
        expect(container.querySelector(`[data-testid="${TEST_IDS.TOAST_FILENAME}"]`)).toHaveTextContent('model.json');
    });

    it('routes through the typed toast when given a ToastType', () => {
        expect(createToastNotification('MLIR', 'model.json', ToastType.SUCCESS)).toBe('success-id');

        expect(toastSuccess).toHaveBeenCalledTimes(1);
        expect(toastFn).not.toHaveBeenCalled();
    });

    it('passes per-toast options through', () => {
        createToastNotification('MLIR', 'model.json', undefined, { autoClose: false });

        expect(toastFn).toHaveBeenCalledWith(expect.anything(), { autoClose: false });
    });
});

describe('createToast', () => {
    it('takes arbitrary content and returns the id the toast was given', () => {
        expect(createToast(<span>Custom body</span>, { hideProgressBar: true })).toBe('toast-id');

        expect(toastFn).toHaveBeenCalledWith(expect.anything(), { hideProgressBar: true });
        expect(lastToastContent().container).toHaveTextContent('Custom body');
    });
});

describe('dismissToast', () => {
    it('dismisses a single toast by id', () => {
        dismissToast('toast-id');

        expect(dismiss).toHaveBeenCalledWith('toast-id');
    });

    it('dismisses every open toast when called with no id', () => {
        dismissToast();

        expect(dismiss).toHaveBeenCalledWith(undefined);
    });
});

describe('useBufferFocus', () => {
    it('opens a toast that persists until dismissed and keeps its id in activeToastAtom', () => {
        const { result } = renderHook(() => useBufferFocus());

        act(() => result.current.updateBufferFocus(1024, 7));

        expect(toastFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ autoClose: false }));
        expect(result.current.activeToast).toBe('toast-id');
    });

    it('dismisses the previous toast before opening the next one', () => {
        const { result } = renderHook(() => useBufferFocus());

        act(() => result.current.updateBufferFocus(1024, 7));
        act(() => result.current.updateBufferFocus(2048, 8));

        expect(dismiss).toHaveBeenCalledWith('toast-id');
    });

    it('dismisses every toast when the selection is reset', () => {
        const { result } = renderHook(() => useBufferFocus());

        act(() => result.current.updateBufferFocus(1024, 7));
        act(() => result.current.resetToasts());

        expect(dismiss).toHaveBeenLastCalledWith(undefined);
        expect(result.current.activeToast).toBeNull();
    });
});
