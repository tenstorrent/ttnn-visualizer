// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

const WAIT_FOR_OPEN = { timeout: 1000 };

/**
 * Opens the Blueprint MultiSelect whose input has this placeholder.
 *
 * MultiSelect decides whether a click opens it a frame later, once the click has focused its input, so
 * this waits for its own combobox to report itself expanded. A portal appearing is not enough: it can
 * belong to another overlay, or mount before the popover has opened. The options can still render after
 * this resolves, so find them with `findBy*` queries.
 */
const openMultiSelect = async (placeholder: string) => {
    const input = screen.getByPlaceholderText(placeholder);
    const combobox = input.closest('[role="combobox"]');

    expect(combobox).not.toBeNull();
    fireEvent.click(input);
    await waitFor(() => expect(combobox).toHaveAttribute('aria-expanded', 'true'), WAIT_FOR_OPEN);
};

export default openMultiSelect;
