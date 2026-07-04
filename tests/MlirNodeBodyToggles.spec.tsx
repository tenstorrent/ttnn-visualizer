// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MlirNodeBodyToggles, { type MlirNodeBodyTogglesState } from '../src/components/mlir/MlirNodeBodyToggles';

afterEach(cleanup);

const bothOff: MlirNodeBodyTogglesState = { location: false, shapes: false };

describe('MlirNodeBodyToggles', () => {
    it('reflects the given state on both switches', () => {
        render(
            <MlirNodeBodyToggles
                value={{ location: true, shapes: false }}
                onChange={() => {}}
            />,
        );
        expect(screen.getByLabelText('Show source location')).toBeChecked();
        expect(screen.getByLabelText('Show shapes')).not.toBeChecked();
    });

    it('emits a merged state (spreading the other field) when the location switch flips', () => {
        // Switching one field should never wipe the other — the parent
        // persists this object to sessionStorage, so a bad merge would
        // silently reset shapes on every location toggle.
        const onChange = vi.fn();
        render(
            <MlirNodeBodyToggles
                value={{ location: false, shapes: true }}
                onChange={onChange}
            />,
        );
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
        expect(screen.getByLabelText('Show source location')).not.toBeChecked();
        expect(screen.getByLabelText('Show shapes')).not.toBeChecked();
    });
});
