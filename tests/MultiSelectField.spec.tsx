// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MultiSelectField from '../src/components/MultiSelectField';
import testForPortal from './helpers/testForPortal';

const PLACEHOLDER = 'Select Value...';
const WAIT_FOR_OPTIONS = { timeout: 1000 };

interface Option {
    value: string;
}

// Three options so a disabled middle one can prove that arrowing lands past it rather than on it.
const OPTIONS: Option[] = [{ value: 'alpha' }, { value: 'beta' }, { value: 'gamma' }];

interface RenderOptions {
    values?: string[];
    disabledValues?: ReadonlySet<string>;
}

function renderField({ values = [], disabledValues }: RenderOptions = {}) {
    const updateHandler = vi.fn();

    render(
        <MultiSelectField<Option, 'value'>
            keyName='value'
            options={OPTIONS}
            placeholder={PLACEHOLDER}
            values={values}
            updateHandler={updateHandler}
            disabledValues={disabledValues}
        />,
    );

    return updateHandler;
}

/** The options only exist while the MultiSelect popover is open. */
const openSelect = async () => {
    fireEvent.click(screen.getByPlaceholderText(PLACEHOLDER));
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
};

/**
 * Blueprint's QueryList drives selection from its own active-item state, which starts on the
 * first option and moves by arrow key. Activation calls `onItemSelect` without going near the
 * option's checkbox, so the `disabled` attribute on it cannot block this route — `itemDisabled`
 * is what keeps the active item off unselectable options in the first place.
 */
const activateOptionByKeyboard = (stepsDown: number) => {
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    for (let step = 0; step < stepsDown; step++) {
        fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 40, which: 40 });
        fireEvent.keyUp(input, { key: 'ArrowDown', keyCode: 40, which: 40 });
    }

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, which: 13 });
    fireEvent.keyUp(input, { key: 'Enter', keyCode: 13, which: 13 });
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MultiSelectField', () => {
    it('renders an option per unique value and disables the ones marked unselectable', async () => {
        renderField({ disabledValues: new Set(['beta']) });

        await openSelect();

        expect(screen.getByRole('checkbox', { name: 'alpha' })).toBeEnabled();
        expect(screen.getByRole('checkbox', { name: 'beta' })).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'gamma' })).toBeEnabled();
    });

    it('toggles a value when an enabled option is clicked', async () => {
        const updateHandler = renderField();

        await openSelect();
        fireEvent.click(screen.getByRole('checkbox', { name: 'alpha' }));

        expect(updateHandler).toHaveBeenCalledTimes(1);
        expect(updateHandler.mock.calls[0][0]([])).toEqual(['alpha']);
    });

    it('arrows past a disabled option to the next selectable one', async () => {
        const updateHandler = renderField({ disabledValues: new Set(['beta']) });

        await openSelect();
        activateOptionByKeyboard(1);

        expect(updateHandler).toHaveBeenCalledTimes(1);
        expect(updateHandler.mock.calls[0][0]([])).toEqual(['gamma']);
    });

    it('still applies keyboard activation of an enabled option', async () => {
        const updateHandler = renderField({ disabledValues: new Set(['beta']) });

        await openSelect();
        activateOptionByKeyboard(0);

        expect(updateHandler).toHaveBeenCalledTimes(1);
        expect(updateHandler.mock.calls[0][0]([])).toEqual(['alpha']);
    });
});
