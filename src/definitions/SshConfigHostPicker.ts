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

export const SSH_CONFIG_HOST_SUBLABEL = 'Prefill from ~/.ssh/config';

/** Ties the picker's label to its control; both dialogs render exactly one picker. */
export const SSH_CONFIG_HOST_INPUT_ID = 'ssh-config-host-picker';
