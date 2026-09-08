// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { MULTIHOST_CHECKBOX_LABEL, MULTIHOST_GROUP_LABEL } from '../../src/definitions/RemoteConnection';

/**
 * Accessible name of the multihost checkbox, for `getByRole('checkbox', { name })`.
 *
 * The multihost FormGroup's label points at the checkbox as well as heading the group, so the
 * checkbox's accessible name is that heading followed by its own label. Composed from both
 * pieces of copy here, which is too easy to get subtly wrong for each spec that needs it to
 * derive its own.
 */
export const MULTIHOST_CHECKBOX_NAME = `${MULTIHOST_GROUP_LABEL} ${MULTIHOST_CHECKBOX_LABEL}`;
