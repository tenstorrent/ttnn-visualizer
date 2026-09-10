// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it, vi } from 'vitest';
import type { Location } from 'react-router';
import ROUTES, { ROUTE_PATTERNS } from '../src/definitions/Routes';
import { EventLogEvent, EventLogView } from '../src/definitions/EventLogEvent';
import { EVENT_LOG_VIEW_BY_ROUTE, getEventLogView, recordViewOpened } from '../src/functions/eventLogViews';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

function locationAt(pathname: string, state: Location['state'] = null): Pick<Location, 'pathname' | 'state'> {
    return { pathname, state };
}

describe('event-log view route mapping', () => {
    it('makes an explicit decision for every route', () => {
        expect(new Set(Object.keys(EVENT_LOG_VIEW_BY_ROUTE))).toEqual(new Set(Object.values(ROUTES)));
    });

    it('uses every parameterised pattern in a route definition', () => {
        const patterns = Object.values(EVENT_LOG_VIEW_BY_ROUTE).flatMap((definition) =>
            definition && 'pattern' in definition ? [definition.pattern] : [],
        );

        expect(Object.values(ROUTE_PATTERNS).every((pattern) => patterns.includes(pattern))).toBe(true);
    });

    it.each([
        [ROUTES.HOME, EventLogView.REPORTS],
        [ROUTES.OPERATIONS, EventLogView.OPERATIONS],
        [ROUTES.TENSORS, EventLogView.TENSORS],
        [ROUTES.BUFFERS, EventLogView.BUFFERS],
        [ROUTES.GRAPHTREE, EventLogView.GRAPH],
        [ROUTES.PERFORMANCE, EventLogView.PERFORMANCE],
        [ROUTES.NPE, EventLogView.NPE],
        [ROUTES.MLIR, EventLogView.MLIR],
    ])('maps %s to %s', (pathname, expected) => {
        expect(getEventLogView(locationAt(pathname))).toBe(expected);
    });

    it.each([
        [`${ROUTES.OPERATIONS}/`, EventLogView.OPERATIONS],
        [ROUTES.TENSORS.toUpperCase(), EventLogView.TENSORS],
    ])('matches static pathname %s the same way React Router does', (pathname, expected) => {
        expect(getEventLogView(locationAt(pathname))).toBe(expected);
    });

    it.each([
        [`${ROUTES.OPERATIONS}/42`, EventLogView.OPERATION_DETAILS],
        [`${ROUTES.GRAPHTREE}/42`, EventLogView.GRAPH],
        [`${ROUTES.NPE}/trace.json`, EventLogView.NPE],
        [`${ROUTES.MLIR}/model.mlir`, EventLogView.MLIR],
    ])('maps parameterised pathname %s to %s', (pathname, expected) => {
        expect(getEventLogView(locationAt(pathname))).toBe(expected);
    });

    it('does not count a topology pathname which renders no overlay', () => {
        expect(getEventLogView(locationAt(ROUTES.CLUSTER))).toBeNull();
    });

    it('maps an open topology overlay to topology', () => {
        expect(
            getEventLogView(
                locationAt(ROUTES.CLUSTER, {
                    background: { pathname: ROUTES.OPERATIONS, key: 'bg', search: '', hash: '', state: null },
                }),
            ),
        ).toBe(EventLogView.TOPOLOGY);
    });

    it.each([ROUTES.STYLEGUIDE, '/does-not-exist', `${ROUTES.TENSORS}/unexpected`])(
        'does not count excluded or unknown pathname %s',
        (pathname) => {
            expect(getEventLogView(locationAt(pathname))).toBeNull();
        },
    );
});

describe('recordViewOpened', () => {
    it('records the closed view vocabulary payload', () => {
        recordViewOpened(EventLogView.OPERATIONS);

        expect(recordEvent).toHaveBeenCalledWith({
            event: EventLogEvent.VIEW_OPENED,
            details: { view: EventLogView.OPERATIONS },
        });
    });
});
