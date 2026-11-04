// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { screen } from '@testing-library/react';
import { openPopover } from './testForPortal';

const WAIT_FOR_OPEN = { timeout: 1000 };

/**
 * Opens the Blueprint MultiSelect whose input has this placeholder. MultiSelect decides whether a click opens
 * it a frame later, once the click has focused its input, so this waits for its own combobox to report itself
 * expanded. The options can still render after this resolves, so find them with `findBy*` queries.
 */
const openMultiSelect = (placeholder: string) => openPopover(screen.getByPlaceholderText(placeholder), WAIT_FOR_OPEN);

export default openMultiSelect;
