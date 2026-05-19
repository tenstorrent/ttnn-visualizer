// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryLegendElement } from '../src/components/operation-details/MemoryLegendElement';
import { MarkerType } from '../src/model/APIData';
import { OperationDetails } from '../src/model/OperationDetails';
import { TestProviders } from './helpers/TestProviders';

const onLegendClick = vi.fn();

const operationDetails = {
    getTensorForAddress: () => undefined,
} as unknown as OperationDetails;

function renderLegendElement(chunk: Parameters<typeof MemoryLegendElement>[0]['chunk']) {
    const { container } = render(
        <TestProviders>
            <MemoryLegendElement
                chunk={chunk}
                memSize={1024}
                selectedTensorAddress={null}
                operationDetails={operationDetails}
                onLegendClick={onLegendClick}
            />
        </TestProviders>,
    );
    return container;
}

afterEach(cleanup);

describe('MemoryLegendElement legend swatches', () => {
    it('renders a vertical-line swatch for L1 START markers', () => {
        const container = renderLegendElement({
            address: 0x1000,
            size: 0,
            markerType: MarkerType.L1_START,
        });

        expect(container.querySelector('.legend-marker-swatch')).toBeInTheDocument();
        expect(container.querySelector('.memory-color-block')).not.toBeInTheDocument();
        expect(container.querySelector('.legend-empty-swatch')).not.toBeInTheDocument();
        expect(screen.getByText('L1 START')).toBeInTheDocument();
    });

    it('renders a dashed swatch for empty memory gaps', () => {
        const container = renderLegendElement({
            address: 0x2000,
            size: 512,
            empty: true,
        });

        expect(container.querySelector('.legend-empty-swatch')).toBeInTheDocument();
        expect(container.querySelector('.memory-color-block')).not.toBeInTheDocument();
        expect(container.querySelector('.legend-marker-swatch')).not.toBeInTheDocument();
        expect(screen.getByText(/Empty space/)).toBeInTheDocument();
    });

    it('renders a filled color block for buffer rows', () => {
        const container = renderLegendElement({
            address: 0x3000,
            size: 256,
        });

        expect(container.querySelector('.memory-color-block')).toBeInTheDocument();
        expect(container.querySelector('.legend-marker-swatch')).not.toBeInTheDocument();
        expect(container.querySelector('.legend-empty-swatch')).not.toBeInTheDocument();
    });
});
