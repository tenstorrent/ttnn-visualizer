// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { detectLayerBlocks } from './opGraphLayerBlocks';
import { detectRepeatBlocks } from './opGraphRepeatBlocks';
import type { OpGraphSourceOperation, RepeatBlockInstance } from './opGraphTypes';
import { OpGraphGrouping } from './opGraphTypes';

/**
 * Which detector each grouping mode runs, in one place because the builder and the
 * worker both need it and a ternary in each silently routed anything new to repeats.
 * A record over the enum makes a third mode — #1953's reconciliation, say — a compile
 * error at both call sites instead. #1976
 */
export const BLOCK_DETECTOR: Readonly<
    Record<OpGraphGrouping, (operations: readonly OpGraphSourceOperation[]) => RepeatBlockInstance[]>
> = {
    [OpGraphGrouping.REPEATS]: detectRepeatBlocks,
    [OpGraphGrouping.LAYERS]: detectLayerBlocks,
};

/** Defaults to `REPEATS`, which is what shipped first. */
export const detectorFor = (
    grouping: OpGraphGrouping | undefined,
): ((operations: readonly OpGraphSourceOperation[]) => RepeatBlockInstance[]) =>
    BLOCK_DETECTOR[grouping ?? OpGraphGrouping.REPEATS];
