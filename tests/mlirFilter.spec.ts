// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { resolveFilterMatches } from '../src/components/mlir/mlirFilter';

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

    it('does not satisfy visibility from a group id sharing the namespace (op-only)', () => {
        // Regression lock for the #1739 item-4 narrowing: visibility is
        // resolved against the op-only id set, not the full RF node array.
        // The *group* id for `region.a` is on canvas, but it must NOT stand
        // in for the op anchor — the buried match has no visible rep.
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [{ id: 'buried-op', label: 'stablehlo.add' }],
            expandedNamespaces: new Set(),
            anchorByNamespace: { 'region.a': 'anchor-op' },
            containingNamespacesByNodeId: { 'buried-op': ['region.a'] },
            visibleOpNodeIds: new Set(['group:region.a']),
        });

        expect(result.visibleRepIds.size).toBe(0);
        expect(result.buriedCountByRepId.size).toBe(0);
        expect(result.hiddenMatchCount).toBe(0);
    });

    it('folds to the op anchor once it is present alongside the group id (op-only twin)', () => {
        // Same fixture as above, but the op anchor is now on canvas: the
        // buried match resolves to the op id. Proves the previous case fails
        // specifically because a group id can't satisfy op-only visibility.
        const result = resolveFilterMatches({
            testLabel: label('add'),
            sources: [{ id: 'buried-op', label: 'stablehlo.add' }],
            expandedNamespaces: new Set(),
            anchorByNamespace: { 'region.a': 'anchor-op' },
            containingNamespacesByNodeId: { 'buried-op': ['region.a'] },
            visibleOpNodeIds: new Set(['group:region.a', 'anchor-op']),
        });

        expect([...result.visibleRepIds]).toEqual(['anchor-op']);
        expect(result.buriedCountByRepId.get('anchor-op')).toBe(1);
        expect(result.hiddenMatchCount).toBe(1);
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
