// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export { DEFAULT_SSH_PORT } from './RemoteConnection';

export interface MlirServerConnection {
    name: string;
    username: string;
    host: string;
    sshPort: number;
    port: number;
    identityFile?: string; // Optional path to SSH private key.
}

export const MLIR_UPLOAD_PATH = '/apipost/v1/upload';

// Model formats the MLIR server (Model Explorer) accepts:
// TF (.pb/.pbtxt/.graphdef), TFLite (.tflite), TFJS/JAX (.json/.pb),
// PyTorch ExportedProgram (.pt2), MLIR (.mlir/.mlirbc).
// Keep in sync with `MLIR_SERVER_ACCEPTED_EXTENSIONS` and `MLIR_UPLOAD_PATH` in
// `backend/ttnn_visualizer/mlir.py` — the backend validates the upload
// against the same list independently of this client-side `accept` filter.
export const MLIR_SERVER_ACCEPTED_EXTENSIONS = [
    '.pb',
    '.pbtxt',
    '.graphdef',
    '.tflite',
    '.json',
    '.pt2',
    '.mlir',
    '.mlirbc',
] as const;
