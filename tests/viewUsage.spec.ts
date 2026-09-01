// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it, vi } from 'vitest';
import ROUTES from '../src/definitions/Routes';
import { UsageEvent, UsageView } from '../src/definitions/UsageEvent';
import { USAGE_VIEW_BY_ROUTE, getUsageView, recordViewOpened } from '../src/functions/viewUsage';

const { recordUsage } = vi.hoisted(() => ({ recordUsage: vi.fn() }));

vi.mock('../src/functions/recordUsage', () => ({ default: recordUsage }));

describe('usage view route mapping', () => {
    it('makes an explicit decision for every route', () => {
        expect(new Set(Object.keys(USAGE_VIEW_BY_ROUTE))).toEqual(new Set(Object.values(ROUTES)));
    });

    it.each([
        [ROUTES.HOME, UsageView.REPORTS],
        [ROUTES.OPERATIONS, UsageView.OPERATIONS],
        [ROUTES.TENSORS, UsageView.TENSORS],
        [ROUTES.BUFFERS, UsageView.BUFFERS],
        [ROUTES.GRAPHTREE, UsageView.GRAPH],
        [ROUTES.PERFORMANCE, UsageView.PERFORMANCE],
        [ROUTES.NPE, UsageView.NPE],
        [ROUTES.MLIR, UsageView.MLIR],
        [ROUTES.CLUSTER, UsageView.TOPOLOGY],
    ])('maps %s to %s', (pathname, expected) => {
        expect(getUsageView(pathname)).toBe(expected);
    });

    it.each([
        [`${ROUTES.OPERATIONS}/42`, UsageView.OPERATION_DETAILS],
        [`${ROUTES.GRAPHTREE}/42`, UsageView.GRAPH],
        [`${ROUTES.NPE}/trace.json`, UsageView.NPE],
        [`${ROUTES.MLIR}/model.mlir`, UsageView.MLIR],
    ])('maps parameterised pathname %s to %s', (pathname, expected) => {
        expect(getUsageView(pathname)).toBe(expected);
    });

    it.each([ROUTES.STYLEGUIDE, '/does-not-exist', `${ROUTES.TENSORS}/unexpected`])(
        'does not count excluded or unknown pathname %s',
        (pathname) => {
            expect(getUsageView(pathname)).toBeNull();
        },
    );
});

describe('recordViewOpened', () => {
    it('records the closed view vocabulary payload', () => {
        recordViewOpened(UsageView.OPERATIONS);

        expect(recordUsage).toHaveBeenCalledWith({
            event: UsageEvent.VIEW_OPENED,
            details: { view: UsageView.OPERATIONS },
        });
    });
});
