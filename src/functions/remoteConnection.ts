// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteConnection } from '../definitions/RemoteConnection';

/**
 * Connection identity as the app has always treated it: name, host and port. Paths and the
 * identity file are editable properties of a connection, not part of which connection it is.
 */
export const isSameConnection = (a?: RemoteConnection | null, b?: RemoteConnection | null): boolean =>
    !!a && !!b && a.name === b.name && a.host === b.host && a.port === b.port;
