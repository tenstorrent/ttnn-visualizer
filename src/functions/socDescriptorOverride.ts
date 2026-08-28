// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ChipDesign } from '../model/ClusterModel';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';

/**
 * Outcome of reading a report-supplied SoC descriptor.
 *
 * Three states rather than `ChipDesign | null`, because absent and malformed
 * need different answers: absent falls back to the baked lookup, malformed must
 * say so. Collapsing them is how an unusable override would render as an empty
 * grid — the failure #1776 is about.
 */
export type SocDescriptorOverride =
    | { status: 'absent' }
    | { status: 'valid'; design: ChipDesign }
    | { status: 'invalid'; problems: string[] };

/** Node lists are `"x-y"` coordinate strings, as the baked descriptors write them. */
const COORDINATE = /^\d+-\d+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const coordinateProblems = (label: string, value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [`\`${label}\` must be an array of "x-y" coordinates`];
    }
    const bad = value.filter((entry) => typeof entry !== 'string' || !COORDINATE.test(entry));
    if (bad.length === 0) {
        return [];
    }
    const count = bad.length === 1 ? '1 entry that is' : `${bad.length} entries that are`;
    return [`\`${label}\` has ${count} not an "x-y" coordinate`];
};

const gridProblems = (grid: unknown): string[] => {
    if (!isRecord(grid)) {
        return ['`grid` must be an object with `x_size` and `y_size`'];
    }
    return (['x_size', 'y_size'] as const).flatMap((axis) => {
        const size = grid[axis];
        return typeof size === 'number' && Number.isInteger(size) && size > 0
            ? []
            : [`\`grid.${axis}\` must be a positive integer`];
    });
};

/**
 * @description Validate a SoC descriptor carried by a report, so a complete
 * device can render without a baked entry for its arch.
 *
 * NPE lands NoC transfers on real node coordinates, so it needs the full grid
 * and there is no report-side substitute. The Quasar-IP family (Grendel and
 * licensee parts) has descriptors rolled by the customer that cannot be bundled,
 * which is what this override exists for. See #1776.
 *
 * Empty `dram` / `eth` / `pcie` are accepted: a tensix-only emulation descriptor
 * legitimately has none, so their absence is a shape to render rather than an
 * error. `functional_workers` is the one list that must be populated — without
 * it there is no grid to draw and falling back would be better than rendering
 * nothing.
 */
export const parseSocDescriptorOverride = (raw: unknown, reportedArch?: string): SocDescriptorOverride => {
    if (raw === undefined || raw === null) {
        return { status: 'absent' };
    }
    if (!isRecord(raw)) {
        return { status: 'invalid', problems: ['the descriptor must be an object'] };
    }

    const problems = [
        ...gridProblems(raw.grid),
        ...coordinateProblems('functional_workers', raw.functional_workers),
        // `dram` is nested one level deeper than the rest: a bank per channel.
        // Optional on the same terms as `eth` / `pcie`, so `grid` and
        // `functional_workers` are the only two a producer must write.
        ...(Array.isArray(raw.dram ?? [])
            ? ((raw.dram ?? []) as unknown[]).flatMap((channel, index) => coordinateProblems(`dram[${index}]`, channel))
            : ['`dram` must be an array of channels']),
        ...coordinateProblems('eth', raw.eth ?? []),
        ...coordinateProblems('pcie', raw.pcie ?? []),
        ...coordinateProblems('arc', raw.arc ?? []),
        ...coordinateProblems('router_only', raw.router_only ?? []),
    ];

    if (Array.isArray(raw.functional_workers) && raw.functional_workers.length === 0) {
        problems.push('`functional_workers` is empty, so there is no grid to render');
    }

    if (problems.length > 0) {
        return { status: 'invalid', problems };
    }

    // The lists are validated above; the cast supplies the defaults that make the
    // result a complete `ChipDesign` for readers that treat those fields as required.
    //
    // `arch_name` carries the descriptor's own label, falling back to the arch the
    // report declared. Never a baked arch: a Quasar override labelled `wormhole`
    // would be reported as Wormhole everywhere the name is displayed, which is a
    // worse answer than an unrecognised one. It is outside `DeviceArchitecture` by
    // design — the whole point is an arch the app does not know.
    return {
        status: 'valid',
        design: {
            ...raw,
            arch_name: (raw.arch_name ?? reportedArch ?? 'unknown') as DeviceArchitecture,
            arc: raw.arc ?? [],
            dram: raw.dram ?? [],
            eth: raw.eth ?? [],
            pcie: raw.pcie ?? [],
            router_only: raw.router_only ?? [],
        } as ChipDesign,
    };
};
