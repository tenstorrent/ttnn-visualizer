// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it, vi } from 'vitest';
import type { Location } from 'react-router';
import ROUTES, { ROUTE_PATTERNS } from '../src/definitions/Routes';
import { UsageEvent, UsageView } from '../src/definitions/UsageEvent';
import { USAGE_VIEW_BY_ROUTE, getUsageView, recordViewOpened } from '../src/functions/viewUsage';

const DELIBERATE_TYPECHECK_FAILURE: string = 42;
void DELIBERATE_TYPECHECK_FAILURE;

const { recordUsage } = vi.hoisted(() => ({ recordUsage: vi.fn() }));

vi.mock('../src/functions/recordUsage', () => ({ default: recordUsage }));

function locationAt(pathname: string, state: Location['state'] = null): Pick<Location, 'pathname' | 'state'> {
    return { pathname, state };
}

describe('usage view route mapping', () => {
    it('makes an explicit decision for every route', () => {
        expect(new Set(Object.keys(USAGE_VIEW_BY_ROUTE))).toEqual(new Set(Object.values(ROUTES)));
    });

    it('uses every parameterised pattern in a route definition', () => {
        const patterns = Object.values(USAGE_VIEW_BY_ROUTE).flatMap((definition) =>
            definition && 'pattern' in definition ? [definition.pattern] : [],
        );

        expect(Object.values(ROUTE_PATTERNS).every((pattern) => patterns.includes(pattern))).toBe(true);
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
    ])('maps %s to %s', (pathname, expected) => {
        expect(getUsageView(locationAt(pathname))).toBe(expected);
    });

    it.each([
        [`${ROUTES.OPERATIONS}/`, UsageView.OPERATIONS],
        [ROUTES.TENSORS.toUpperCase(), UsageView.TENSORS],
    ])('matches static pathname %s the same way React Router does', (pathname, expected) => {
        expect(getUsageView(locationAt(pathname))).toBe(expected);
    });

    it.each([
        [`${ROUTES.OPERATIONS}/42`, UsageView.OPERATION_DETAILS],
        [`${ROUTES.GRAPHTREE}/42`, UsageView.GRAPH],
        [`${ROUTES.NPE}/trace.json`, UsageView.NPE],
        [`${ROUTES.MLIR}/model.mlir`, UsageView.MLIR],
    ])('maps parameterised pathname %s to %s', (pathname, expected) => {
        expect(getUsageView(locationAt(pathname))).toBe(expected);
    });

    it('does not count a topology pathname which renders no overlay', () => {
        expect(getUsageView(locationAt(ROUTES.CLUSTER))).toBeNull();
    });

    it('maps an open topology overlay to topology', () => {
        expect(
            getUsageView(
                locationAt(ROUTES.CLUSTER, {
                    background: { pathname: ROUTES.OPERATIONS, key: 'bg', search: '', hash: '', state: null },
                }),
            ),
        ).toBe(UsageView.TOPOLOGY);
    });

    it.each([ROUTES.STYLEGUIDE, '/does-not-exist', `${ROUTES.TENSORS}/unexpected`])(
        'does not count excluded or unknown pathname %s',
        (pathname) => {
            expect(getUsageView(locationAt(pathname))).toBeNull();
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
