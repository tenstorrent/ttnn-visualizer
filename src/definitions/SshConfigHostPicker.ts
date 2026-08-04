// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Sentinel for the dropdown's “Custom” option. The backend drops wildcard patterns,
 * so `*` can never collide with a concrete alias the way a plausible name like
 * `custom` could.
 */
export const SSH_CONFIG_HOST_CUSTOM = '*';

/** Picker label — the accessible name both dialogs and their tests address it by. */
export const SSH_CONFIG_HOST_LABEL = 'SSH config host';

/** Option copy for {@link SSH_CONFIG_HOST_CUSTOM}, asserted on by the picker's tests. */
export const SSH_CONFIG_HOST_CUSTOM_LABEL = 'Custom';
