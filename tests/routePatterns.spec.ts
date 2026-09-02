// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ROUTE_PATTERNS } from '../src/definitions/Routes';
import { routeObjectList } from '../src/routes/routeObjectList';

const PATTERN_PARAM = /\/:[^/?]+[?]*/g;

function patternBase(pattern: string): string {
    return pattern.replace(PATTERN_PARAM, '');
}

function matchingChildPath(pathname: string): string | undefined {
    const matches = matchRoutes([{ path: '/', children: routeObjectList }], pathname);

    return matches?.find((match) => typeof match.route.path === 'string' && match.route.path !== '/')?.route.path;
}

const stripFirstSlash = (path: string) => (path.startsWith('/') ? path.slice(1) : path);

describe('ROUTE_PATTERNS', () => {
    it.each(Object.values(ROUTE_PATTERNS))(
        'keeps %s matching both its bare path and a parameterised child',
        (pattern) => {
            const base = patternBase(pattern);
            const relativePattern = stripFirstSlash(pattern);

            expect(matchingChildPath(`${base}/x`)).toBe(relativePattern);

            // Optional params share one route object with the bare path. Required params
            // have a static sibling for the bare path; dropping `?` makes the bare path
            // match nothing.
            if (pattern.includes('?')) {
                expect(matchingChildPath(base)).toBe(relativePattern);
            } else {
                expect(matchingChildPath(base)).toBeDefined();
                expect(matchingChildPath(base)).not.toBe(relativePattern);
            }
        },
    );
});
