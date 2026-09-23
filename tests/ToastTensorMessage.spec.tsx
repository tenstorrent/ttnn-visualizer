// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ToastDeselectButton } from '../src/components/operation-details/ToastTensorMessage';

afterEach(cleanup);

describe('ToastDeselectButton', () => {
    it('deselects when clicked', () => {
        const onDeselect = vi.fn();
        render(<ToastDeselectButton onDeselect={onDeselect} />);

        screen.getByRole('button', { name: /deselect/i }).click();

        expect(onDeselect).toHaveBeenCalledTimes(1);
    });

    it('does not let the click reach the toast behind it', () => {
        // react-toastify puts this inside the toast, and the toast carries the same
        // handler on its own body. Without stopping here the selection would be cleared
        // twice per click — harmless, but it makes the button look conditional on the
        // body handler rather than sufficient by itself.
        const onDeselect = vi.fn();
        const onToastClick = vi.fn();
        render(
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
            <div onClick={onToastClick}>
                <ToastDeselectButton onDeselect={onDeselect} />
            </div>,
        );

        screen.getByRole('button', { name: /deselect/i }).click();

        expect(onDeselect).toHaveBeenCalledTimes(1);
        expect(onToastClick).not.toHaveBeenCalled();
    });

    it('is reachable by name, since it renders as a bare icon', () => {
        render(<ToastDeselectButton onDeselect={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Deselect buffer' })).toBeInTheDocument();
    });
});
