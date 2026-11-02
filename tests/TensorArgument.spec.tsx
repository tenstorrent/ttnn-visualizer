// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TensorArgument from '../src/components/TensorArgument';
import { withParsedMemoryConfig } from '../src/functions/parseMemoryConfig';

const MEMORY_CONFIG =
    'MemoryConfig(memory_layout=TensorMemoryLayout::WIDTH_SHARDED,buffer_type=BufferType::L1,shard_spec=std::nullopt,nd_shard_spec=std::nullopt,created_with_nd_shard_spec=0)';
const TENSOR_REPR = `ttnn.Tensor(shape=Shape([1, 1000]), dtype=DataType.BFLOAT16, layout=Layout.TILE, memory_config=${MEMORY_CONFIG}, storage_type=StorageType.DEVICE, placements=['PlacementReplicate()'])`;

// Builds the argument as `fetchOperations` hands it to the view.
const renderArgument = (name: string, value: string) =>
    render(<TensorArgument argument={{ parsedValue: null, ...withParsedMemoryConfig({ name, value }) }} />);

afterEach(() => {
    cleanup();
});

describe('TensorArgument', () => {
    it('renders a whole memory config as a table', () => {
        renderArgument('memory_config', MEMORY_CONFIG);

        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(screen.getByText('MemoryLayout')).toBeInTheDocument();
    });

    it('renders a tensor repr as its text, not as its memory config', () => {
        renderArgument('memory_config', TENSOR_REPR);

        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.getByText(TENSOR_REPR)).toBeInTheDocument();
    });
});
