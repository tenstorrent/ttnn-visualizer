// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { MouseEvent, ReactElement } from 'react';
import { act, render, renderHook, within } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { Id, ToastContent, ToastOptions } from 'react-toastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import createToastNotification, { createToast, dismissToast } from '../src/functions/createToastNotification';
import { ToastType } from '../src/definitions/ToastType';
import { TEST_IDS } from '../src/definitions/TestIds';
import useBufferFocus from '../src/hooks/useBufferFocus';
import { activeToastAtom } from '../src/store/app';

// The wrapper's whole job is what it hands `react-toastify`, so the spec asserts on the
// calls rather than on rendered output -- no `<ToastContainer>` is mounted here. Every
// mocked toast issues a *fresh* id, without which an assertion about which toast was
// dismissed passes whether or not the right one was named.
const { dismiss, toastFn, typedToasts } = vi.hoisted(() => {
    let issued = 0;
    const issueId = (_content: ToastContent, _options?: ToastOptions): Id => {
        issued += 1;
        return `toast-${issued}`;
    };

    return {
        dismiss: vi.fn(),
        toastFn: vi.fn(issueId),
        // Keyed by the `ToastType` values themselves; `vi.hoisted` runs before imports,
        // so the enum cannot be referenced here.
        typedToasts: {
            info: vi.fn(issueId),
            success: vi.fn(issueId),
            warning: vi.fn(issueId),
            error: vi.fn(issueId),
        },
    };
});

vi.mock('react-toastify', () => ({
    toast: Object.assign(toastFn, { ...typedToasts, dismiss }),
}));

const lastToastCall = () => toastFn.mock.calls.at(-1)!;
const renderLastToastContent = () => render(lastToastCall()[0] as ReactElement);

beforeEach(() => {
    vi.clearAllMocks();
    getDefaultStore().set(activeToastAtom, null);
});

describe('createToastNotification', () => {
    it('hands over the shared file-change template and returns the toast id', () => {
        expect(createToastNotification('MLIR', 'model.json')).toBe(toastFn.mock.results[0].value);

        const { container } = renderLastToastContent();

        expect(container).toHaveTextContent('MLIR');
        expect(within(container).getByTestId(TEST_IDS.TOAST_FILENAME)).toHaveTextContent('model.json');
    });

    it.each(Object.values(ToastType))('routes a %s toast through the matching typed toast', (type) => {
        const toastId = createToastNotification('MLIR', 'model.json', type);

        expect(typedToasts[type]).toHaveBeenCalledTimes(1);
        expect(typedToasts[type]).toHaveReturnedWith(toastId);
        expect(toastFn).not.toHaveBeenCalled();
    });
});

describe('createToast', () => {
    it('takes arbitrary content, passes options through, and returns the id', () => {
        const toastId = createToast(<span>Custom body</span>, { hideProgressBar: true });

        expect(toastFn).toHaveBeenCalledWith(expect.anything(), { hideProgressBar: true });
        expect(toastId).toBe(toastFn.mock.results[0].value);
        expect(renderLastToastContent().container).toHaveTextContent('Custom body');
    });
});

describe('dismissToast', () => {
    it('dismisses a single toast by id', () => {
        dismissToast('toast-1');

        expect(dismiss).toHaveBeenCalledWith('toast-1');
    });

    it('dismisses every open toast when called with no id', () => {
        dismissToast();

        expect(dismiss).toHaveBeenCalledWith(undefined);
    });
});

describe('useBufferFocus', () => {
    const focusBuffer = () => {
        const { result } = renderHook(() => useBufferFocus());

        act(() => result.current.updateBufferFocus(1024, 7));

        return result;
    };

    it('opens a toast that persists until dismissed and records the selection', () => {
        const result = focusBuffer();

        expect(toastFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ autoClose: false }));
        expect(result.current.activeToast).toBe(toastFn.mock.results[0].value);
        expect(result.current.selectedAddress).toBe(1024);
        expect(result.current.selectedTensorId).toBe(7);
        expect(result.current.selectedBufferColour).toEqual(expect.any(String));
    });

    it('opens the first toast without dismissing anything', () => {
        focusBuffer();

        expect(dismiss).not.toHaveBeenCalled();
    });

    it('dismisses the previous toast, not the new one, before opening the next', () => {
        const result = focusBuffer();
        const previousToast = result.current.activeToast;

        act(() => result.current.updateBufferFocus(2048, 8));

        expect(result.current.activeToast).not.toBe(previousToast);
        expect(dismiss).toHaveBeenCalledTimes(1);
        expect(dismiss).toHaveBeenCalledWith(previousToast);
        expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(toastFn.mock.invocationCallOrder[1]);
    });

    it('clears the selection when the toast itself is clicked', () => {
        const result = focusBuffer();
        const { onClick } = lastToastCall()[1]!;

        act(() => onClick!({} as MouseEvent<HTMLElement>));

        expect(result.current.activeToast).toBeNull();
        expect(result.current.selectedAddress).toBeNull();
        expect(result.current.selectedTensorId).toBeNull();
        expect(result.current.selectedBufferColour).toBeNull();
        expect(dismiss).toHaveBeenLastCalledWith(undefined);
    });

    it('dismisses every toast when the selection is reset', () => {
        const result = focusBuffer();

        act(() => result.current.resetToasts());

        expect(dismiss).toHaveBeenLastCalledWith(undefined);
        expect(result.current.activeToast).toBeNull();
    });
});
