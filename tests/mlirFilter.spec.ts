// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { MlirFilterMode, buildFilterMatcher, resolveFilterMatches } from '../src/components/mlir/mlirFilter';

describe('buildFilterMatcher', () => {
    describe('empty query', () => {
        it.each([[MlirFilterMode.Substring], [MlirFilterMode.Regex]] as const)(
            'rejects every label in %s mode',
            (mode) => {
                const { testLabel, isRegexInvalid } = buildFilterMatcher(mode, '');

                expect(testLabel('stablehlo.constant')).toBe(false);
                expect(testLabel('')).toBe(false);
                expect(isRegexInvalid).toBe(false);
            },
        );
    });

    describe('substring mode', () => {
        it('matches case-insensitive substrings', () => {
            const { testLabel } = buildFilterMatcher(MlirFilterMode.Substring, 'Add');

            expect(testLabel('stablehlo.add')).toBe(true);
            expect(testLabel('stablehlo.ADD')).toBe(true);
            expect(testLabel('stablehlo.subtract')).toBe(false);
        });

        it('treats regex metacharacters as literals', () => {
            const { testLabel } = buildFilterMatcher(MlirFilterMode.Substring, 'co*');

            // Literal `co*` never appears in normal op names.
            expect(testLabel('stablehlo.constant')).toBe(false);
            expect(testLabel('stablehlo.broadcast_in_dim')).toBe(false);
            // But the literal three-char sequence does match if it's present.
            expect(testLabel('stablehlo.co*_debug')).toBe(true);
        });

        it('never reports isRegexInvalid', () => {
            expect(buildFilterMatcher(MlirFilterMode.Substring, '(').isRegexInvalid).toBe(false);
            expect(buildFilterMatcher(MlirFilterMode.Substring, '[unclosed').isRegexInvalid).toBe(false);
        });
    });

    describe('regex mode', () => {
        it('matches case-insensitive patterns', () => {
            const { testLabel } = buildFilterMatcher(MlirFilterMode.Regex, '^stablehlo\\.');

            expect(testLabel('stablehlo.constant')).toBe(true);
            expect(testLabel('STABLEHLO.constant')).toBe(true);
            expect(testLabel('ttir.stablehlo.constant')).toBe(false);
        });

        it('honours zero-or-more semantics — `co*` matches a bare `c`', () => {
            // Regression for the "why is broadcast_in_dim matched by `co*`" question:
            // `co*` = `c` + zero-or-more `o`, so `c` alone in `broadcast` matches.
            const { testLabel } = buildFilterMatcher(MlirFilterMode.Regex, 'co*');

            expect(testLabel('stablehlo.constant')).toBe(true);
            expect(testLabel('stablehlo.broadcast_in_dim')).toBe(true);
            expect(testLabel('stablehlo.add')).toBe(false);
        });

        it('flags invalid patterns and rejects every label without throwing', () => {
            const { testLabel, isRegexInvalid } = buildFilterMatcher(MlirFilterMode.Regex, '(');

            expect(isRegexInvalid).toBe(true);
            expect(testLabel('stablehlo.constant')).toBe(false);
            expect(testLabel('anything')).toBe(false);
        });

        it('does not conflate "no matches" with "invalid regex"', () => {
            const { testLabel, isRegexInvalid } = buildFilterMatcher(MlirFilterMode.Regex, '^zzz$');

            expect(isRegexInvalid).toBe(false);
            expect(testLabel('stablehlo.constant')).toBe(false);
        });
    });
});

describe('resolveFilterMatches', () => {
    const label = (needle: string) => (str: string) => str.includes(needle);
    const emptyIndex = { anchorByNamespace: {}, containingNamespacesByNodeId: {} };

    it('returns matches directly when the source itself is on canvas', () => {
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [
                { id: 'op-1', label: 'stablehlo.add' },
                { id: 'op-2', label: 'stablehlo.subtract' },
            ],
            expandedNamespaces: new Set(),
            ...emptyIndex,
            visibleOpNodeIds: new Set(['op-1', 'op-2']),
        });

        expect([...result.visibleRepIds]).toEqual(['op-1']);
        expect(result.buriedCountByRepId.size).toBe(0);
        expect(result.hiddenMatchCount).toBe(0);
    });

    it('folds a buried match to its outer collapsed anchor', () => {
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [{ id: 'buried-op', label: 'stablehlo.add' }],
            expandedNamespaces: new Set(),
            anchorByNamespace: { 'region.a': 'anchor-op' },
            containingNamespacesByNodeId: { 'buried-op': ['region.a'] },
            visibleOpNodeIds: new Set(['anchor-op']),
        });

        expect([...result.visibleRepIds]).toEqual(['anchor-op']);
        expect(result.buriedCountByRepId.get('anchor-op')).toBe(1);
        expect(result.hiddenMatchCount).toBe(1);
    });

    it('picks the outermost collapsed namespace when several nest', () => {
        // outer→inner: `region.outer` is preferred over `region.inner` because
        // it's the first collapsed namespace walking from the top.
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [{ id: 'buried-op', label: 'stablehlo.add' }],
            expandedNamespaces: new Set(),
            anchorByNamespace: {
                'region.outer': 'outer-anchor',
                'region.inner': 'inner-anchor',
            },
            containingNamespacesByNodeId: { 'buried-op': ['region.outer', 'region.inner'] },
            visibleOpNodeIds: new Set(['outer-anchor', 'inner-anchor']),
        });

        expect([...result.visibleRepIds]).toEqual(['outer-anchor']);
        expect(result.buriedCountByRepId.get('outer-anchor')).toBe(1);
    });

    it('skips collapsed namespaces whose anchor is off-canvas (op-only visibility)', () => {
        // Regression lock for the #1739 item-4 narrowing: visibility must be
        // resolved against the op-only id set, not the full RF node array.
        // A group id sharing a name with the expected anchor must NOT satisfy
        // visibility.
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [{ id: 'buried-op', label: 'stablehlo.add' }],
            expandedNamespaces: new Set(),
            anchorByNamespace: { 'region.a': 'anchor-op' },
            containingNamespacesByNodeId: { 'buried-op': ['region.a'] },
            visibleOpNodeIds: new Set(),
        });

        expect(result.visibleRepIds.size).toBe(0);
        expect(result.buriedCountByRepId.size).toBe(0);
        expect(result.hiddenMatchCount).toBe(0);
    });

    it('descends into inner namespaces once outer ones are expanded', () => {
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [{ id: 'buried-op', label: 'stablehlo.add' }],
            expandedNamespaces: new Set(['region.outer']),
            anchorByNamespace: {
                'region.outer': 'outer-anchor',
                'region.inner': 'inner-anchor',
            },
            containingNamespacesByNodeId: { 'buried-op': ['region.outer', 'region.inner'] },
            visibleOpNodeIds: new Set(['outer-anchor', 'inner-anchor']),
        });

        expect([...result.visibleRepIds]).toEqual(['inner-anchor']);
        expect(result.buriedCountByRepId.get('inner-anchor')).toBe(1);
    });

    it('surfaces the source itself once every containing namespace is expanded', () => {
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [{ id: 'op-1', label: 'stablehlo.add' }],
            expandedNamespaces: new Set(['region.outer', 'region.inner']),
            anchorByNamespace: {
                'region.outer': 'outer-anchor',
                'region.inner': 'inner-anchor',
            },
            containingNamespacesByNodeId: { 'op-1': ['region.outer', 'region.inner'] },
            visibleOpNodeIds: new Set(['op-1', 'outer-anchor', 'inner-anchor']),
        });

        expect([...result.visibleRepIds]).toEqual(['op-1']);
        expect(result.buriedCountByRepId.size).toBe(0);
        expect(result.hiddenMatchCount).toBe(0);
    });

    it('coalesces multiple buried matches onto the same anchor', () => {
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [
                { id: 'buried-1', label: 'stablehlo.add' },
                { id: 'buried-2', label: 'stablehlo.add.sibling' },
                { id: 'op-outside', label: 'stablehlo.add' },
            ],
            expandedNamespaces: new Set(),
            anchorByNamespace: { 'region.a': 'anchor-op' },
            containingNamespacesByNodeId: {
                'buried-1': ['region.a'],
                'buried-2': ['region.a'],
            },
            visibleOpNodeIds: new Set(['anchor-op', 'op-outside']),
        });

        expect([...result.visibleRepIds].sort()).toEqual(['anchor-op', 'op-outside']);
        expect(result.buriedCountByRepId.get('anchor-op')).toBe(2);
        expect(result.hiddenMatchCount).toBe(2);
    });

    it('falls back to the source id when the outer collapsed namespace has no anchor entry', () => {
        // Mirrors `resolveRenderedNodeId`'s `?? nodeId` clause: a namespace
        // that appears in `containing` but is missing from `anchorByNamespace`
        // falls back to the source id for visibility.
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [{ id: 'op-1', label: 'stablehlo.add' }],
            expandedNamespaces: new Set(),
            anchorByNamespace: {},
            containingNamespacesByNodeId: { 'op-1': ['region.orphan'] },
            visibleOpNodeIds: new Set(['op-1']),
        });

        expect([...result.visibleRepIds]).toEqual(['op-1']);
        expect(result.buriedCountByRepId.size).toBe(0);
        expect(result.hiddenMatchCount).toBe(0);
    });
});
