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

/**
 * Option copy for {@link SSH_CONFIG_HOST_CUSTOM}. Both dialogs render this picker, so the
 * option has to name what the dialog around it saves — a shared label reads as the wrong
 * noun in one of them.
 */
export const SSH_CONFIG_HOST_ADD_CONNECTION_LABEL = 'Add new connection';
export const SSH_CONFIG_HOST_ADD_SERVER_LABEL = 'Add new server';

/** Option copy for {@link SSH_CONFIG_HOST_UNSELECTED}; only offered until a choice is made. */
export const SSH_CONFIG_HOST_UNSELECTED_LABEL = 'Please select...';

/**
 * Heading over the aliases read from `~/.ssh/config`, which is the one thing the options in
 * this dropdown don't otherwise have in common: picking one prefills the form from a stanza
 * the user already wrote, where the option above it starts an empty one.
 */
export const SSH_CONFIG_HOST_GROUP_LABEL = '~/.ssh/config';

/**
 * The picker carries no heading of its own, so this doubles as the select's accessible name —
 * what a screen reader announces is then the same wording that's on screen.
 */
export const SSH_CONFIG_HOST_SUBLABEL = 'Define new connection or prefill from ~/.ssh/config';

/** Points the control at {@link SSH_CONFIG_HOST_SUBLABEL}; both dialogs render one picker. */
export const SSH_CONFIG_HOST_SUBLABEL_ID = 'ssh-config-host-picker-sublabel';

export const SSH_CONFIG_HOST_INPUT_ID = 'ssh-config-host-picker';
