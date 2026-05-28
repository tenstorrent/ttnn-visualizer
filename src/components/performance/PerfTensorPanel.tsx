// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import { parsePerfRowTensors } from '../../functions/parsePerfRowTensors';
import { OperationDescription } from '../../model/APIData';
import { TEST_IDS } from '../../definitions/TestIds';
import PerfTensorRow from './PerfTensorRow';

interface PerfTensorPanelProps {
    row: TypedPerfTableRow;
    operation: OperationDescription | null;
    operations: OperationDescription[];
}

function renderInputSection(
    isEnriched: boolean,
    operation: OperationDescription | null,
    operations: OperationDescription[],
    basicInputs: ReturnType<typeof parsePerfRowTensors>['inputs'],
) {
    if (isEnriched && operation) {
        if (operation.inputs.length === 0) {
            return (
                <p className='perf-tensor-panel-empty'>
                    <em>No input tensors</em>
                </p>
            );
        }

        return operation.inputs.map((tensor, index) => (
            <PerfTensorRow
                key={`input-${tensor.id}-${index}`}
                mode='enriched'
                tensor={tensor}
                operations={operations}
                label={`Input ${index}`}
            />
        ));
    }

    if (basicInputs.length === 0) {
        return (
            <p className='perf-tensor-panel-empty'>
                <em>No input tensor data</em>
            </p>
        );
    }

    return basicInputs.map((basic) => (
        <PerfTensorRow
            key={basic.label}
            mode='basic'
            basic={basic}
        />
    ));
}

function renderOutputSection(
    isEnriched: boolean,
    operation: OperationDescription | null,
    operations: OperationDescription[],
    basicOutputs: ReturnType<typeof parsePerfRowTensors>['outputs'],
) {
    if (isEnriched && operation) {
        if (operation.outputs.length === 0) {
            return (
                <p className='perf-tensor-panel-empty'>
                    <em>No output tensors</em>
                </p>
            );
        }

        return operation.outputs.map((tensor, index) => (
            <PerfTensorRow
                key={`output-${tensor.id}-${index}`}
                mode='enriched'
                tensor={tensor}
                operations={operations}
                label={`Output ${index}`}
            />
        ));
    }

    if (basicOutputs.length === 0) {
        return (
            <p className='perf-tensor-panel-empty'>
                <em>No output tensor data</em>
            </p>
        );
    }

    return basicOutputs.map((basic) => (
        <PerfTensorRow
            key={basic.label}
            mode='basic'
            basic={basic}
        />
    ));
}

function PerfTensorPanel({ row, operation, operations }: PerfTensorPanelProps) {
    const isEnriched = operation !== null && row.op !== undefined;
    const basicTensors = parsePerfRowTensors(row);

    return (
        <div className='perf-tensor-panel'>
            {!isEnriched ? (
                <Callout
                    intent={Intent.PRIMARY}
                    className='perf-tensor-panel-cta'
                    data-testid={TEST_IDS.PERF_TENSOR_DRAWER_CTA}
                >
                    Load a memory/profiler report to see tensor shapes, addresses, and producer/consumer links.
                </Callout>
            ) : null}

            <section className='perf-tensor-panel-section'>
                <h3 className='perf-tensor-panel-heading'>Inputs</h3>
                {renderInputSection(isEnriched, operation, operations, basicTensors.inputs)}
            </section>

            <section className='perf-tensor-panel-section'>
                <h3 className='perf-tensor-panel-heading'>Outputs</h3>
                {renderOutputSection(isEnriched, operation, operations, basicTensors.outputs)}
            </section>
        </div>
    );
}

export default PerfTensorPanel;
