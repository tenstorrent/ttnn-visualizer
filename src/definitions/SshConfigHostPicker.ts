// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Sentinel for "no alias — the form is being filled in by hand". The backend drops wildcard
 * patterns, so `*` can never collide with a concrete alias the way a plausible name like
 * `custom` could. Its option copy varies per dialog, so describe it by this name and not by
 * whatever the dropdown currently reads.
 */
export const SSH_CONFIG_HOST_CUSTOM = '*';

/**
 * Sentinel for "the user hasn't chosen yet", distinct from {@link SSH_CONFIG_HOST_CUSTOM}
 * so a new connection can hold its form back until the choice is made. An empty alias is
 * not something `~/.ssh/config` can express, so it can't collide with a real host.
 */
export const SSH_CONFIG_HOST_UNSELECTED = '';

/** Picker label — the accessible name both dialogs and their tests address it by. */
export const SSH_CONFIG_HOST_LABEL = 'SSH config host';

/**
 * Option copy for {@link SSH_CONFIG_HOST_CUSTOM}. Both dialogs render this picker, so the
 * option has to name what the dialog around it saves — a shared label reads as the wrong
 * noun in one of them.
 */
export const SSH_CONFIG_HOST_ADD_CONNECTION_LABEL = 'Add new connection';
export const SSH_CONFIG_HOST_ADD_SERVER_LABEL = 'Add new server';

/** Option copy for {@link SSH_CONFIG_HOST_UNSELECTED}; only offered until a choice is made. */
export const SSH_CONFIG_HOST_UNSELECTED_LABEL = 'Please select...';

export const SSH_CONFIG_HOST_SUBLABEL = 'Prefill from ~/.ssh/config';

/** Ties the picker's label to its control; both dialogs render exactly one picker. */
export const SSH_CONFIG_HOST_INPUT_ID = 'ssh-config-host-picker';
