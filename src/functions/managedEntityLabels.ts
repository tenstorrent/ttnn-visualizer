// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { CONFIRM_DELETE_LABEL, ManagedEntity } from '../definitions/ManagedEntity';

/**
 * Row actions repeat down a dropdown, so each accessible name carries the item it belongs to —
 * otherwise every row announces identically and nothing but position tells them apart. Both
 * verbs are derived here so the three selectors cannot drift into naming the same action
 * differently, and so the delete label matches the confirmation dialog it opens.
 */
export const getEditActionLabel = (entity: ManagedEntity, itemName: string): string => `Edit ${entity} ${itemName}`;

export const getDeleteActionLabel = (entity: ManagedEntity, itemName: string): string =>
    `${CONFIRM_DELETE_LABEL} ${entity} ${itemName}`;
