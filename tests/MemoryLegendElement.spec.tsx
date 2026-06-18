// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryLegendElement } from '../src/components/operation-details/MemoryLegendElement';
import { MarkerType } from '../src/model/APIData';
import { StringBufferType } from '../src/model/BufferType';
import { OperationDetails } from '../src/model/OperationDetails';
import { TestProviders } from './helpers/TestProviders';

const onLegendClick = vi.fn();

const operationDetails = {
    getTensorForAddress: () => undefined,
} as unknown as OperationDetails;

type LegendProps = Parameters<typeof MemoryLegendElement>[0];

function renderLegendElement(chunk: LegendProps['chunk'], extraProps: Partial<LegendProps> = {}) {
    const { container } = render(
        <TestProviders>
            <MemoryLegendElement
                chunk={chunk}
                memSize={1024}
                selectedTensorAddress={null}
                operationDetails={operationDetails}
                onLegendClick={onLegendClick}
                {...extraProps}
            />
        </TestProviders>,
    );
    return container;
}

afterEach(cleanup);

describe('MemoryLegendElement legend swatches', () => {
    it.each([
        [MarkerType.L1_START, 'L1 START'],
        [MarkerType.L1_SMALL, 'L1 SMALL'],
    ])('renders a vertical-line swatch for %s markers', (markerType, label) => {
        const container = renderLegendElement({
            address: 0x1000,
            size: 0,
            markerType,
        });

        expect(container.querySelector('.legend-marker-swatch')).toBeInTheDocument();
        expect(container.querySelector('.memory-color-block')).not.toBeInTheDocument();
        expect(container.querySelector('.legend-empty-swatch')).not.toBeInTheDocument();
        expect(screen.getByText(label)).toBeInTheDocument();
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

describe('MemoryLegendElement core count label', () => {
    const chunk = { address: 0x4000, size: 1024 };

    it('renders "x 1 core" for a single-core CB (no bufferType)', () => {
        renderLegendElement(chunk, { numCores: 1 });
        expect(screen.getByText(/x 1 core(?!s)/)).toBeInTheDocument();
    });

    it('renders "x 64 cores" for a multi-core L1 allocation', () => {
        renderLegendElement(chunk, { numCores: 64, bufferType: StringBufferType.L1 });
        expect(screen.getByText(/x 64 cores/)).toBeInTheDocument();
    });

    it('renders "x 1 core" for a single-core L1 allocation', () => {
        renderLegendElement(chunk, { numCores: 1, bufferType: StringBufferType.L1 });
        expect(screen.getByText(/x 1 core(?!s)/)).toBeInTheDocument();
    });

    it('omits the label for DRAM allocations even when numCores is provided', () => {
        renderLegendElement(chunk, { numCores: 1, bufferType: StringBufferType.DRAM });
        expect(screen.queryByText(/x 1 core/)).not.toBeInTheDocument();
        expect(screen.queryByText(/cores?/)).not.toBeInTheDocument();
    });

    it('omits the label for SYSTEM_MEMORY allocations', () => {
        renderLegendElement(chunk, { numCores: 8, bufferType: StringBufferType.SYSTEM_MEMORY });
        expect(screen.queryByText(/cores?/)).not.toBeInTheDocument();
    });

    it('omits the label when numCores is unset', () => {
        renderLegendElement(chunk);
        expect(screen.queryByText(/cores?/)).not.toBeInTheDocument();
    });

    it('omits the label when numCores is zero', () => {
        renderLegendElement(chunk, { numCores: 0 });
        expect(screen.queryByText(/cores?/)).not.toBeInTheDocument();
    });
});

describe('MemoryLegendElement globally_allocated marker (#1651)', () => {
    const chunk = { address: 0x4000, size: 1024 };

    it('does not render the marker by default', () => {
        renderLegendElement(chunk);

        expect(screen.queryByText('Globally allocated')).not.toBeInTheDocument();
        expect(document.querySelector('.globally-allocated-marker')).not.toBeInTheDocument();
        expect(document.querySelector('.memory-color-block-outline')).not.toBeInTheDocument();
    });

    it('renders the outline-only swatch and marker when isGloballyAllocated is true', () => {
        const container = renderLegendElement(chunk, { isGloballyAllocated: true });

        const swatch = container.querySelector('.memory-color-block') as HTMLElement | null;
        expect(swatch).not.toBeNull();
        expect(swatch).toHaveClass('memory-color-block-outline');
        // Outline-only swatches drop the fill so the colour signal sits on the
        // border instead. The inline style is the source of truth for both.
        expect(swatch!.style.backgroundColor).toBe('transparent');

        expect(screen.getByText('Globally allocated')).toBeInTheDocument();
        const marker = container.querySelector('.globally-allocated-marker');
        expect(marker).toHaveAttribute('aria-label', expect.stringMatching(/Globally allocated.*aliased to tensor/i));

        const row = container.querySelector('.legend-item');
        expect(row).toHaveClass('globally-allocated');
    });
});
