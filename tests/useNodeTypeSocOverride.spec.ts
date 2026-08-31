// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNodeType } from '../src/hooks/useAPI';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';

// The arch an unknown part reports: no baked descriptor exists for it, which is
// the case #1776 is about (Grendel and the licensee Quasar-IP parts).
const UNKNOWN_ARCH = 'grendel_xyz' as DeviceArchitecture;

// Shape of the fixture built from `report_with_zones`: a complete descriptor
// carried by the report itself.
const suppliedDescriptor = {
    arch_name: 'GRENDEL_XYZ',
    grid: { x_size: 10, y_size: 8 },
    functional_workers: ['2-2', '3-2', '4-2'],
    dram: [['2-7'], ['4-0']],
    eth: [],
    pcie: [],
    arc: [],
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useNodeType with a report-supplied SoC descriptor (#1776)', () => {
    it('renders an unknown arch from the supplied descriptor', () => {
        // Before this, an arch with no baked entry resolved to null and NPE drew
        // nothing but an "Unsupported architecture" toast.
        const { result } = renderHook(() => useNodeType(UNKNOWN_ARCH, suppliedDescriptor));

        expect(result.current.overrideProblems).toBeNull();
        expect(result.current.architecture).not.toBeNull();
        expect(result.current.architecture?.grid).toEqual({ x_size: 10, y_size: 8 });
        // Coordinates are parsed to [y, x] pairs for the grid renderer.
        expect(result.current.cores).toEqual([
            [2, 2],
            [2, 3],
            [2, 4],
        ]);
        expect(result.current.dram).toEqual([
            [7, 2],
            [0, 4],
        ]);
    });

    it('still resolves a known arch from the baked descriptor when nothing is supplied', () => {
        const { result } = renderHook(() => useNodeType(DeviceArchitecture.WORMHOLE));

        expect(result.current.overrideProblems).toBeNull();
        expect(result.current.architecture).not.toBeNull();
        // 80 functional workers in the baked Wormhole descriptor.
        expect(result.current.cores).toHaveLength(80);
    });

    it('prefers the supplied descriptor over a baked one for the same arch', () => {
        const { result } = renderHook(() => useNodeType(DeviceArchitecture.WORMHOLE, suppliedDescriptor));

        expect(result.current.architecture?.grid).toEqual({ x_size: 10, y_size: 8 });
        expect(result.current.cores).toHaveLength(3);
    });

    it('leaves an unknown arch unresolved when nothing is supplied', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() => useNodeType(UNKNOWN_ARCH));

        expect(result.current.architecture).toBeNull();
        expect(result.current.overrideProblems).toBeNull();
        expect(consoleError).toHaveBeenCalledWith(`Unsupported arch: ${UNKNOWN_ARCH}`);
    });

    it('reports a malformed descriptor rather than treating it as absent', () => {
        // The distinction the caller needs: a descriptor that was offered and
        // rejected gets an explicit error, not the generic "unsupported" path.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const malformed = {
            grid: { x_size: 0, y_size: 'eight' },
            functional_workers: ['1-1', 'nope'],
            dram: 'not-a-list',
        };

        const { result } = renderHook(() => useNodeType(UNKNOWN_ARCH, malformed));

        expect(result.current.overrideProblems).not.toBeNull();
        expect(result.current.overrideProblems?.join(' ')).toContain('grid.x_size');
        expect(result.current.architecture).toBeNull();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Unusable SoC descriptor'));
        // Not also the generic message: that would hide which of the two happened.
        expect(consoleError).not.toHaveBeenCalledWith(`Unsupported arch: ${UNKNOWN_ARCH}`);
    });

    it('keeps a malformed descriptor from masking a usable baked one', () => {
        // The override failed, but Wormhole is still renderable. Reporting the
        // problem and rendering what we have beats an empty grid.
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const { result } = renderHook(() => useNodeType(DeviceArchitecture.WORMHOLE, { grid: 'nonsense' }));

        expect(result.current.overrideProblems).not.toBeNull();
        expect(result.current.architecture).not.toBeNull();
        expect(result.current.cores).toHaveLength(80);
    });
});
