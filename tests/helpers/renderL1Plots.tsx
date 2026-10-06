// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ComponentProps } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import L1Plots from '../../src/components/operation-details/L1Plots';
import { OperationDetails } from '../../src/model/OperationDetails';
import { AtomProviderInitialValues } from './atomProvider';
import { FIXTURE_L1_SIZE } from './operationDetailsFixtures';
import { TestProviders } from './TestProviders';

type L1PlotsProps = ComponentProps<typeof L1Plots>;

interface RenderL1PlotsOptions extends Partial<Omit<L1PlotsProps, 'operationDetails'>> {
    operationDetails: OperationDetails;
    initialAtomValues?: AtomProviderInitialValues;
}

/**
 * Renders `L1Plots` unzoomed over the fixture L1 size, with CBs and L1 Small
 * hidden unless the spec asks for them. Specs that assert on the plot itself
 * still import `./mocks/plotComponent` for the Plotly mock.
 */
export const renderL1Plots = ({ operationDetails, initialAtomValues = [], ...props }: RenderL1PlotsOptions) =>
    render(
        <TestProviders initialAtomValues={initialAtomValues}>
            <L1Plots
                operationDetails={operationDetails}
                previousOperationDetails={operationDetails}
                zoomedInViewMainMemory={false}
                plotZoomRangeStart={0}
                plotZoomRangeEnd={FIXTURE_L1_SIZE}
                showCircularBuffer={false}
                showL1Small={false}
                onBufferClick={vi.fn()}
                onLegendClick={vi.fn()}
                {...props}
            />
        </TestProviders>,
    );
