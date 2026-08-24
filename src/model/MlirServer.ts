// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface MlirServerConnection {
    name: string;
    username: string;
    host: string;
    sshPort: number;
    port: number;
    identityFile?: string; // Optional path to SSH private key.
}
