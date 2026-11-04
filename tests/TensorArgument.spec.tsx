// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TensorArgument from '../src/components/TensorArgument';
import { withParsedMemoryConfig } from '../src/functions/parseMemoryConfig';
import { makeTensorRepr } from './helpers/operationDescription';

const MEMORY_CONFIG =
    'MemoryConfig(memory_layout=TensorMemoryLayout::WIDTH_SHARDED,buffer_type=BufferType::L1,shard_spec=std::nullopt,nd_shard_spec=std::nullopt,created_with_nd_shard_spec=0)';
const TENSOR_REPR = makeTensorRepr(MEMORY_CONFIG);

// Builds the argument as `fetchOperations` hands it to the view.
const renderArgument = (name: string, value: string) =>
    render(<TensorArgument argument={withParsedMemoryConfig({ name, value })} />);

afterEach(() => {
    cleanup();
});

describe('TensorArgument', () => {
    it('renders a whole memory config as a table', () => {
        renderArgument('memory_config', MEMORY_CONFIG);

        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(screen.getByText('MemoryLayout')).toBeInTheDocument();
        expect(screen.getByText('WIDTH_SHARDED')).toBeInTheDocument();
    });

    it('renders a tensor repr as its text, not as its memory config', () => {
        renderArgument('memory_config', TENSOR_REPR);

        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.getByText(TENSOR_REPR)).toBeInTheDocument();
    });

    it('renders a multi-line tensor repr as a collapsed tensor, not as its memory config', () => {
        renderArgument('memory_config', makeTensorRepr(MEMORY_CONFIG, '[[1.0, 2.0],\n [3.0, 4.0]]'));

        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Show full tensor')).toBeInTheDocument();
        expect(screen.getByText('ttnn.Tensor([[1.0, 2.0],')).toBeInTheDocument();
    });

    it('renders a value that is not a memory config as its text', () => {
        renderArgument('memory_config', 'std::nullopt');

        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.getByText('std::nullopt')).toBeInTheDocument();
    });

    it('renders a NULL value from the database without crashing', () => {
        // The column is nullable, though the type says otherwise.
        const argument = { name: 'memory_config', value: null as unknown as string, parsedValue: null };
        const { container } = render(<TensorArgument argument={argument} />);

        expect(container).toBeEmptyDOMElement();
    });
});
