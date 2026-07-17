// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ComponentProps } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import MlirExpandCollapseControls from '../src/components/mlir/MlirExpandCollapseControls';

afterEach(cleanup);

describe('MlirExpandCollapseControls', () => {
    const buildProps = (overrides: Partial<ComponentProps<typeof MlirExpandCollapseControls>> = {}) => ({
        namespaceCount: 3,
        expandedCount: 1,
        onExpandAll: vi.fn(),
        onCollapseAll: vi.fn(),
        ...overrides,
    });

    it('renders Expand all + Collapse all with the correct labels and visible text', () => {
        render(<MlirExpandCollapseControls {...buildProps()} />);
        expect(screen.getByRole('button', { name: /expand all subgraphs/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /collapse all subgraphs/i })).toBeInTheDocument();
        expect(screen.getByText('Expand all')).toBeInTheDocument();
        expect(screen.getByText('Collapse all')).toBeInTheDocument();
    });

    it('fires onExpandAll when the Expand all button is clicked', () => {
        const onExpandAll = vi.fn();
        render(<MlirExpandCollapseControls {...buildProps({ onExpandAll })} />);
        fireEvent.click(screen.getByRole('button', { name: /expand all subgraphs/i }));
        expect(onExpandAll).toHaveBeenCalledTimes(1);
    });

    it('fires onCollapseAll when the Collapse all button is clicked', () => {
        const onCollapseAll = vi.fn();
        render(<MlirExpandCollapseControls {...buildProps({ onCollapseAll })} />);
        fireEvent.click(screen.getByRole('button', { name: /collapse all subgraphs/i }));
        expect(onCollapseAll).toHaveBeenCalledTimes(1);
    });

    it('disables both buttons when the graph has no collapsible namespaces', () => {
        render(<MlirExpandCollapseControls {...buildProps({ namespaceCount: 0, expandedCount: 0 })} />);
        expect(screen.getByRole('button', { name: /expand all subgraphs/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /collapse all subgraphs/i })).toBeDisabled();
    });

    it('disables Expand all when every collapsible namespace is already expanded', () => {
        render(<MlirExpandCollapseControls {...buildProps({ namespaceCount: 4, expandedCount: 4 })} />);
        expect(screen.getByRole('button', { name: /expand all subgraphs/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /collapse all subgraphs/i })).not.toBeDisabled();
    });

    it('disables Collapse all when nothing is expanded (already at top-level anchors)', () => {
        render(<MlirExpandCollapseControls {...buildProps({ namespaceCount: 4, expandedCount: 0 })} />);
        expect(screen.getByRole('button', { name: /expand all subgraphs/i })).not.toBeDisabled();
        expect(screen.getByRole('button', { name: /collapse all subgraphs/i })).toBeDisabled();
    });

    it('enables both when the graph is partially expanded', () => {
        render(<MlirExpandCollapseControls {...buildProps({ namespaceCount: 4, expandedCount: 2 })} />);
        expect(screen.getByRole('button', { name: /expand all subgraphs/i })).not.toBeDisabled();
        expect(screen.getByRole('button', { name: /collapse all subgraphs/i })).not.toBeDisabled();
    });

    it('does not fire callbacks when a disabled button is clicked (no collapsible namespaces)', () => {
        const onExpandAll = vi.fn();
        const onCollapseAll = vi.fn();
        render(
            <MlirExpandCollapseControls
                {...buildProps({ namespaceCount: 0, expandedCount: 0, onExpandAll, onCollapseAll })}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /expand all subgraphs/i }));
        fireEvent.click(screen.getByRole('button', { name: /collapse all subgraphs/i }));
        expect(onExpandAll).not.toHaveBeenCalled();
        expect(onCollapseAll).not.toHaveBeenCalled();
    });

    it('does not fire onExpandAll when every namespace is already expanded', () => {
        const onExpandAll = vi.fn();
        render(<MlirExpandCollapseControls {...buildProps({ namespaceCount: 4, expandedCount: 4, onExpandAll })} />);
        fireEvent.click(screen.getByRole('button', { name: /expand all subgraphs/i }));
        expect(onExpandAll).not.toHaveBeenCalled();
    });

    it('does not fire onCollapseAll when nothing is expanded', () => {
        const onCollapseAll = vi.fn();
        render(<MlirExpandCollapseControls {...buildProps({ namespaceCount: 4, expandedCount: 0, onCollapseAll })} />);
        fireEvent.click(screen.getByRole('button', { name: /collapse all subgraphs/i }));
        expect(onCollapseAll).not.toHaveBeenCalled();
    });

    it('locks both buttons and shows the layout status with the node count while building', () => {
        render(
            <MlirExpandCollapseControls
                {...buildProps({ namespaceCount: 4, expandedCount: 2, isBuilding: true, nodeCount: 42 })}
            />,
        );
        expect(screen.getByRole('button', { name: /expand all subgraphs/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /collapse all subgraphs/i })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Laying out 42 nodes…');
    });

    it('omits the count from the status when nodeCount is not provided', () => {
        render(<MlirExpandCollapseControls {...buildProps({ isBuilding: true })} />);
        expect(screen.getByRole('status')).toHaveTextContent('Laying out…');
    });

    it('does not render the layout status when idle', () => {
        render(<MlirExpandCollapseControls {...buildProps()} />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('does not fire callbacks while a rebuild is in flight', () => {
        const onExpandAll = vi.fn();
        const onCollapseAll = vi.fn();
        render(
            <MlirExpandCollapseControls
                {...buildProps({ namespaceCount: 4, expandedCount: 2, isBuilding: true, onExpandAll, onCollapseAll })}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /expand all subgraphs/i }));
        fireEvent.click(screen.getByRole('button', { name: /collapse all subgraphs/i }));
        expect(onExpandAll).not.toHaveBeenCalled();
        expect(onCollapseAll).not.toHaveBeenCalled();
    });
});
