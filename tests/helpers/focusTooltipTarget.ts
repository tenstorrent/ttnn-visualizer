// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { fireEvent } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Focuses a Blueprint tooltip's target, first checking it is reachable from the keyboard.
 * The tooltip makes its target focusable, which `fireEvent.focus` alone would not show: it
 * fires on any element, focusable or not.
 */
export function focusTooltipTarget(target: HTMLElement) {
    expect(target).toHaveAttribute('tabindex', '0');
    fireEvent.focus(target);
}
