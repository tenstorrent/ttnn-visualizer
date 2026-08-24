// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { screen } from '@testing-library/react';
import { RemoteConnection } from '../../src/model/RemoteConnection';
import { ManagedEntity } from '../../src/definitions/ManagedEntity';
import { getDeleteActionLabel, getEditActionLabel } from '../../src/functions/managedEntityLabels';

/**
 * Anchored on the formatted connection string so it matches the Select trigger only — row action
 * labels carry the connection name too, and a bare name matches those as well.
 */
export const getConnectionTrigger = (connection: RemoteConnection) =>
    screen.getByRole('button', { name: new RegExp(`^${connection.name} - ssh`) });

export const getEditConnectionLabel = (connection: RemoteConnection) =>
    getEditActionLabel(ManagedEntity.REMOTE_CONNECTION, connection.name);

export const getDeleteConnectionLabel = (connection: RemoteConnection) =>
    getDeleteActionLabel(ManagedEntity.REMOTE_CONNECTION, connection.name);
