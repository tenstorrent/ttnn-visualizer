// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ConnectionTestStates } from '../definitions/ConnectionStatus';
import { GraphBundle, MlirFileResult } from '../model/MLIRJsonModel';

interface ConvertedMlirServerResult {
    filename: string;
    host?: string | null;
    name: string | null;
    status: ConnectionTestStates;
    message?: string;
    detail?: string;
    graph?: GraphBundle | null;
}

// Shared convert-response → overlay row mapping for upload and retry. Server
// paths already relabel graph ids on the backend before respond/persist — do
// not call `relabelMlirGraphIds` here (local JSON loads own that rewrite).
const mapConvertedMlirServerResult = (
    result: ConvertedMlirServerResult,
    hostFallback: string | null,
): MlirFileResult => ({
    filename: result.filename,
    host: result.host ?? hostFallback,
    name: result.name,
    status: result.status,
    message: result.message ?? result.detail,
    graph: result.graph ?? null,
    persisted: true,
});

export default mapConvertedMlirServerResult;
