// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Button, MenuItem, Popover, Tooltip } from '@blueprintjs/core';
import { Select } from '@blueprintjs/select';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import testForPortal, { openPopover } from './helpers/testForPortal';

const WAIT_FOR_OPTIONS = { timeout: 1000 };

const MenuPopover = () => (
    <Popover content={<div>Menu content</div>}>
        <Button text='Open menu' />
    </Popover>
);

/** A select whose button sits in a tooltip, as the report pickers' buttons do. */
const SelectWithTooltip = () => (
    <Select<string>
        items={['alpha']}
        itemRenderer={(item, { handleClick, modifiers }) => (
            <MenuItem
                key={item}
                text={item}
                onClick={handleClick}
                active={modifiers.active}
            />
        )}
        onItemSelect={() => undefined}
    >
        <Tooltip content='Pick a value'>
            <Button text='Pick' />
        </Tooltip>
    </Select>
);

afterEach(cleanup);

describe('openPopover', () => {
    it('opens a closed popover', async () => {
        render(<MenuPopover />);

        await openPopover(screen.getByRole('button', { name: 'Open menu' }), WAIT_FOR_OPTIONS);

        expect(await screen.findByText('Menu content')).toBeVisible();
    });

    it('leaves an open popover open rather than toggling it closed', async () => {
        render(<MenuPopover />);
        const trigger = screen.getByRole('button', { name: 'Open menu' });

        await openPopover(trigger, WAIT_FOR_OPTIONS);
        await openPopover(trigger, WAIT_FOR_OPTIONS);

        expect(trigger.closest('[aria-expanded]')).toHaveAttribute('aria-expanded', 'true');
    });

    it('finds the select past a tooltip wrapped round its button', async () => {
        render(<SelectWithTooltip />);

        await openPopover(screen.getByRole('button', { name: 'Pick' }), WAIT_FOR_OPTIONS);

        expect(await screen.findByText('alpha')).toBeVisible();
    });
});

describe('testForPortal', () => {
    it("isn't satisfied by the empty portal a closed select leaves behind", () => {
        render(<SelectWithTooltip />);

        expect(testForPortal).toThrow();
    });
});
