// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { OperationDescription } from '../../model/APIData';
import PerfTensorRow from './PerfTensorRow';

interface PerfTensorPanelProps {
    operation: OperationDescription;
    operations: OperationDescription[];
}

function PerfTensorPanel({ operation, operations }: PerfTensorPanelProps) {
    return (
        <div className='perf-tensor-panel'>
            <section className='perf-tensor-panel-section'>
                <h3 className='perf-tensor-panel-heading'>Inputs</h3>

                {operation.inputs.length > 0 ? (
                    operation.inputs.map((tensor, index) => (
                        <PerfTensorRow
                            key={`input-${tensor.id}-${index}`}
                            tensor={tensor}
                            operations={operations}
                            label={`Input ${index}`}
                        />
                    ))
                ) : (
                    <p className='perf-tensor-panel-empty'>
                        <em>No input tensors</em>
                    </p>
                )}
            </section>

            <section className='perf-tensor-panel-section'>
                <h3 className='perf-tensor-panel-heading'>Outputs</h3>

                {operation.outputs.length > 0 ? (
                    operation.outputs.map((tensor, index) => (
                        <PerfTensorRow
                            key={`output-${tensor.id}-${index}`}
                            tensor={tensor}
                            operations={operations}
                            label={`Output ${index}`}
                        />
                    ))
                ) : (
                    <p className='perf-tensor-panel-empty'>
                        <em>No output tensors</em>
                    </p>
                )}
            </section>
        </div>
    );
}

export default PerfTensorPanel;
