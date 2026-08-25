// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Why OpenSSH refused a host key. Keep in sync with `backend/ttnn_visualizer/enums.py`.
 *
 * String-valued because it crosses the wire, unlike `ConnectionTestStates`, whose ordinals
 * are its serialised form.
 *
 * Its own module rather than living beside `ConnectionStatus`: the status interface needs
 * the `HostKeyStatus` shape from `model/`, and that shape needs this enum, so keeping both
 * in one file makes `definitions` and `model` import each other.
 */
export enum HostKeyIssue {
    UNKNOWN = 'unknown',
    CHANGED = 'changed',
    /** The offered key is one `known_hosts` blacklists with `@revoked`. No remedy here. */
    REVOKED = 'revoked',
}
