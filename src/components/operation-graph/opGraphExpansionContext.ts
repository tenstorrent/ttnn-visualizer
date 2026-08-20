// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { createContext } from 'react';

/**
 * Node types are registered once at module scope and node `data` is built in the
 * layout worker, so neither can carry a callback. Context is how a node reaches
 * the view that owns expansion state without breaking either constraint.
 *
 * The default is inert rather than throwing: a node rendered outside the provider
 * is a wiring mistake, not a reason to blank the canvas.
 */
export const OpGraphExpansionContext = createContext<(operationId: number) => void>(() => {});
