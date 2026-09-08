// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MlirNodeBodyToggles, { type MlirNodeBodyTogglesState } from '../src/components/mlir/MlirNodeBodyToggles';

afterEach(cleanup);

const bothOff: MlirNodeBodyTogglesState = { location: false, shapes: false };

// Switches now live behind a click-popover; open it before querying them.
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Node body overlays' }));

describe('MlirNodeBodyToggles', () => {
    it('reflects the given state on both switches', () => {
        render(
            <MlirNodeBodyToggles
                value={{ location: true, shapes: false }}
                onChange={() => {}}
            />,
        );
        openMenu();
        expect(screen.getByLabelText('Show source location')).toBeChecked();
        expect(screen.getByLabelText('Show shapes')).not.toBeChecked();
    });

    it('emits a merged state (spreading the other field) when the location switch flips', () => {
        // Switching one field should never wipe the other — the parent
        // persists this object through `mlirNodeBodyTogglesAtom`, so a
        // bad merge would silently reset shapes on every location toggle.
        const onChange = vi.fn();
        render(
            <MlirNodeBodyToggles
                value={{ location: false, shapes: true }}
                onChange={onChange}
            />,
        );
        openMenu();
        fireEvent.click(screen.getByLabelText('Show source location'));
        expect(onChange).toHaveBeenCalledWith({ location: true, shapes: true });
    });

    it('emits a merged state when the shapes switch flips', () => {
        const onChange = vi.fn();
        render(
            <MlirNodeBodyToggles
                value={{ location: true, shapes: false }}
                onChange={onChange}
            />,
        );
        openMenu();
        fireEvent.click(screen.getByLabelText('Show shapes'));
        expect(onChange).toHaveBeenCalledWith({ location: true, shapes: true });
    });

    it('renders in the both-off state without checking either switch', () => {
        render(
            <MlirNodeBodyToggles
                value={bothOff}
                onChange={() => {}}
            />,
        );
        openMenu();
        expect(screen.getByLabelText('Show source location')).not.toBeChecked();
        expect(screen.getByLabelText('Show shapes')).not.toBeChecked();
    });

    it('disables the trigger and keeps the popover shut while a layout is building', () => {
        render(
            <MlirNodeBodyToggles
                value={bothOff}
                onChange={() => {}}
                disabled
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Node body overlays' });
        expect(trigger).toBeDisabled();

        openMenu();
        expect(screen.queryByLabelText('Show source location')).not.toBeInTheDocument();
    });

    it('shows the count of active overlays on the collapsed trigger', () => {
        const { rerender } = render(
            <MlirNodeBodyToggles
                value={bothOff}
                onChange={() => {}}
            />,
        );
        const trigger = () => screen.getByRole('button', { name: 'Node body overlays' });
        expect(trigger()).not.toHaveTextContent(/[12]/);

        rerender(
            <MlirNodeBodyToggles
                value={{ location: true, shapes: false }}
                onChange={() => {}}
            />,
        );
        expect(trigger()).toHaveTextContent('1');

        rerender(
            <MlirNodeBodyToggles
                value={{ location: true, shapes: true }}
                onChange={() => {}}
            />,
        );
        expect(trigger()).toHaveTextContent('2');
    });
});
