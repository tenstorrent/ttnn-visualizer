// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ConfirmDeleteAlert from '../src/components/ConfirmDeleteAlert';
import { CANCEL_DELETE_LABEL, CONFIRM_DELETE_LABEL, ManagedEntity } from '../src/definitions/ManagedEntity';

const ENTITY_NAME = 'worker-01 report';

const renderAlert = (overrides: Partial<Parameters<typeof ConfirmDeleteAlert>[0]> = {}) => {
    const props = {
        isOpen: true,
        entity: ManagedEntity.REPORT,
        entityName: ENTITY_NAME,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        ...overrides,
    };

    render(<ConfirmDeleteAlert {...props} />);

    return props;
};

afterEach(cleanup);

it.each(Object.values(ManagedEntity))('names the %s being deleted', (entity) => {
    renderAlert({ entity });

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
        `Are you sure you want to delete the ${entity} ${ENTITY_NAME}?`,
    );
});

it('renders nothing while closed', () => {
    renderAlert({ isOpen: false });

    expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('confirms with the delete button', () => {
    const { onConfirm, onCancel } = renderAlert();

    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
});

it('cancels with the cancel button', () => {
    const { onConfirm, onCancel } = renderAlert();

    fireEvent.click(screen.getByRole('button', { name: CANCEL_DELETE_LABEL }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
});

it('cancels on escape, so the destructive action is never the default', () => {
    const { onConfirm, onCancel } = renderAlert();

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape', code: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
});

it('cancels on a click outside the dialog', () => {
    const { onConfirm, onCancel } = renderAlert();
    const backdrop = document.querySelector('.bp6-overlay-backdrop');

    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
});

it('renders extra consequences under the default sentence', () => {
    renderAlert({ children: <p>Its cached report lists will be cleared too.</p> });

    const dialogText = screen.getByRole('alertdialog').textContent ?? '';

    expect(dialogText.indexOf('Are you sure')).toBeLessThan(dialogText.indexOf('Its cached report lists'));
});
