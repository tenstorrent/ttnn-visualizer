// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getLastConsumerLink, getOperationLink } from '../src/functions/getOperationLink';
import ROUTES from '../src/definitions/Routes';
import { Operation, Tensor } from '../src/model/APIData';
import { TestProviders } from './helpers/TestProviders';

const makeOperation = (overrides: Pick<Operation, 'id' | 'name'> & Partial<Operation>): Operation => ({
    inputs: [],
    outputs: [],
    stack_trace: '',
    stack_trace_source_file_id: null,
    device_operations: [],
    operationFileIdentifier: `${overrides.name}.cpp`,
    error: null,
    ...overrides,
});

const makeTensor = (consumers: number[]): Tensor =>
    ({
        id: 1,
        address: 0,
        buffer_type: null,
        producers: [],
        consumers,
        producerNames: [],
        consumerNames: [],
        shape: 'Shape([1])',
        dtype: 'DataType::BFLOAT16',
        layout: 'Layout::TILE',
        memory_config: null,
        device_id: 0,
        comparison: null,
        io: null,
        size: null,
    }) as unknown as Tensor;

const renderLink = (node: ReturnType<typeof getOperationLink>) => render(<TestProviders>{node}</TestProviders>);

afterEach(cleanup);

describe('getOperationLink', () => {
    const matmul = makeOperation({ id: 11, name: 'matmul' });
    const operations: Operation[] = [matmul];

    it('renders a link to the matching operation', () => {
        renderLink(getOperationLink(11, operations));

        const link = screen.getByRole('link', { name: /11 matmul/i });
        expect(link).toHaveAttribute('href', `${ROUTES.OPERATIONS}/11`);
        expect(link).toHaveTextContent('(matmul.cpp)');
    });

    it('returns null when the operation id is not found', () => {
        expect(getOperationLink(999, operations)).toBeNull();
    });
});

describe('getLastConsumerLink', () => {
    const matmul = makeOperation({ id: 11, name: 'matmul' });
    const consumer = makeOperation({ id: 12, name: 'consumer_op' });
    const dealloc = makeOperation({ id: 13, name: 'deallocate' });
    const operations: Operation[] = [matmul, consumer, dealloc];

    it('links to the trailing consumer when it is not a deallocate op', () => {
        const tensor = makeTensor([11, 12]);
        renderLink(getLastConsumerLink(tensor, operations));

        const link = screen.getByRole('link', { name: /12 consumer_op/i });
        expect(link).toHaveAttribute('href', `${ROUTES.OPERATIONS}/12`);
    });

    it('skips a trailing deallocate and links to the prior consumer', () => {
        const tensor = makeTensor([11, 12, 13]);
        renderLink(getLastConsumerLink(tensor, operations));

        const link = screen.getByRole('link', { name: /12 consumer_op/i });
        expect(link).toHaveAttribute('href', `${ROUTES.OPERATIONS}/12`);
        expect(screen.queryByRole('link', { name: /13 deallocate/i })).not.toBeInTheDocument();
    });

    it('falls back to the deallocate op when it is the only consumer', () => {
        const tensor = makeTensor([13]);
        renderLink(getLastConsumerLink(tensor, operations));

        const link = screen.getByRole('link', { name: /13 deallocate/i });
        expect(link).toHaveAttribute('href', `${ROUTES.OPERATIONS}/13`);
    });

    it('returns null when no consumer operation is found', () => {
        const tensor = makeTensor([999]);
        expect(getLastConsumerLink(tensor, operations)).toBeNull();
    });
});
