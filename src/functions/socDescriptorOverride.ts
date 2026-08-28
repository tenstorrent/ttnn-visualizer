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

/**
 * Renderer-safe ceilings. `EmptyChipRenderer` materialises one element per cell,
 * so the grid is a direct multiplier on DOM size: a report asking for
 * 1,000,000 x 1,000,000 would hang the tab before anything drew. The largest real
 * part is ~17 x 12, so these leave roughly two orders of magnitude of headroom
 * while keeping a nonsense value from reaching React. #1776
 */
const MAX_GRID_AXIS = 256;
const MAX_GRID_CELLS = 16_384;

interface GridExtent {
    xSize: number;
    ySize: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Problems with one node list, including any coordinate outside `extent`.
 *
 * The bounds check is the difference between rejecting a descriptor and rendering
 * an empty grid from it: `EmptyChipRenderer` walks x < width and y < height and
 * looks each cell up by coordinate, so a worker at `99-99` on a 4x4 grid is never
 * visited and silently disappears — the exact failure this validation exists to
 * prevent. `extent` is null only when `grid` itself failed, where a bound would
 * be meaningless and the grid problem is already reported.
 */
const coordinateProblems = (label: string, value: unknown, extent: GridExtent | null): string[] => {
    if (!Array.isArray(value)) {
        return [`\`${label}\` must be an array of "x-y" coordinates`];
    }

    const malformed = value.filter((entry) => typeof entry !== 'string' || !COORDINATE.test(entry));
    if (malformed.length > 0) {
        const count = malformed.length === 1 ? '1 entry that is' : `${malformed.length} entries that are`;
        return [`\`${label}\` has ${count} not an "x-y" coordinate`];
    }

    if (extent === null) {
        return [];
    }

    const outside = (value as string[]).filter((entry) => {
        const [x, y] = entry.split('-').map(Number);
        return x >= extent.xSize || y >= extent.ySize;
    });
    if (outside.length === 0) {
        return [];
    }
    const shown = outside.slice(0, 3).join(', ');
    const rest = outside.length > 3 ? `, and ${outside.length - 3} more` : '';
    return [`\`${label}\` has coordinates outside the ${extent.xSize}x${extent.ySize} grid: ${shown}${rest}`];
};

const gridProblems = (grid: unknown): string[] => {
    if (!isRecord(grid)) {
        return ['`grid` must be an object with `x_size` and `y_size`'];
    }

    const problems = (['x_size', 'y_size'] as const).flatMap((axis) => {
        const size = grid[axis];
        if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
            return [`\`grid.${axis}\` must be a positive integer`];
        }
        return size > MAX_GRID_AXIS ? [`\`grid.${axis}\` is ${size}, above the ${MAX_GRID_AXIS} limit`] : [];
    });
    if (problems.length > 0) {
        return problems;
    }

    const cells = (grid.x_size as number) * (grid.y_size as number);
    return cells > MAX_GRID_CELLS ? [`\`grid\` asks for ${cells} cells, above the ${MAX_GRID_CELLS} limit`] : [];
};

/** The extent to bounds-check against, or null when `grid` is unusable. */
const gridExtent = (grid: unknown): GridExtent | null => {
    if (!isRecord(grid) || gridProblems(grid).length > 0) {
        return null;
    }
    return { xSize: grid.x_size as number, ySize: grid.y_size as number };
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

    const extent = gridExtent(raw.grid);
    const problems = [
        ...gridProblems(raw.grid),
        ...coordinateProblems('functional_workers', raw.functional_workers, extent),
        // `dram` is nested one level deeper than the rest: a bank per channel.
        // Optional on the same terms as `eth` / `pcie`, so `grid` and
        // `functional_workers` are the only two a producer must write.
        ...(Array.isArray(raw.dram ?? [])
            ? ((raw.dram ?? []) as unknown[]).flatMap((channel, index) =>
                  coordinateProblems(`dram[${index}]`, channel, extent),
              )
            : ['`dram` must be an array of channels']),
        ...coordinateProblems('eth', raw.eth ?? [], extent),
        ...coordinateProblems('pcie', raw.pcie ?? [], extent),
        ...coordinateProblems('arc', raw.arc ?? [], extent),
        ...coordinateProblems('router_only', raw.router_only ?? [], extent),
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
