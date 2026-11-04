// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OperationArguments from '../src/components/OperationArguments';
import { withParsedMemoryConfig } from '../src/functions/parseMemoryConfig';
import { makeMemoryConfigArgument, makeOperation, makeTensorRepr } from './helpers/operationDescription';

const MEMORY_CONFIG = makeMemoryConfigArgument('L1').value;

// The argument rows the operations list and operation details view share, with arguments as `fetchOperations` hands them over.
const renderArguments = () =>
    render(
        <OperationArguments
            operation={makeOperation({
                arguments: [
                    { name: 'memory_config', value: MEMORY_CONFIG },
                    { name: 'input_tensor', value: makeTensorRepr(MEMORY_CONFIG) },
                    { name: '1', value: '1, -1, 144' },
                ].map(withParsedMemoryConfig),
            })}
        />,
    );

const rowFor = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

afterEach(() => {
    cleanup();
});

describe('OperationArguments', () => {
    it('shows only the whole memory config as a nested table', () => {
        renderArguments();

        expect(within(rowFor('memory_config')).getByRole('table')).toBeInTheDocument();
        expect(within(rowFor('input_tensor')).queryByRole('table')).not.toBeInTheDocument();
        expect(within(rowFor('input_tensor')).getByText(makeTensorRepr(MEMORY_CONFIG))).toBeInTheDocument();
        expect(within(rowFor('1')).getByText('1, -1, 144')).toBeInTheDocument();
    });
});
