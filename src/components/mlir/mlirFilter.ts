// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/* eslint-disable no-continue */

// String-backed so the enum member values match the historical `sessionStorage`
// payload ('substring' / 'regex'); persisted state migrates without a version bump.
export enum MlirFilterMode {
    Substring = 'substring',
    Regex = 'regex',
}

export interface MlirFilterMatcher {
    /** True if a source label should be treated as a filter match. */
    testLabel: (label: string) => boolean;
    /** True only in regex mode when the query fails to compile. */
    isRegexInvalid: boolean;
}

// Empty queries and invalid regexes both surface a matcher that rejects
// everything so the caller doesn't need branch-per-case handling; the
// `isRegexInvalid` flag lets the UI distinguish "no query" from "bad regex".
export function buildFilterMatcher(mode: MlirFilterMode, query: string): MlirFilterMatcher {
    if (query.length === 0) {
        return { testLabel: () => false, isRegexInvalid: false };
    }
    if (mode === MlirFilterMode.Regex) {
        try {
            const re = new RegExp(query, 'i');
            return { testLabel: (label) => re.test(label), isRegexInvalid: false };
        } catch {
            return { testLabel: () => false, isRegexInvalid: true };
        }
    }
    const needle = query.toLowerCase();
    return {
        testLabel: (label) => label.toLowerCase().includes(needle),
        isRegexInvalid: false,
    };
}

export interface FilterMatchResolution {
    visibleRepIds: Set<string>;
    buriedCountByRepId: Map<string, number>;
    hiddenMatchCount: number;
}

export interface FilterMatchInputs {
    testLabel: (label: string) => boolean;
    sources: readonly { id: string; label: string }[];
    expandedNamespaces: ReadonlySet<string>;
    anchorByNamespace: Readonly<Record<string, string>>;
    containingNamespacesByNodeId: Readonly<Record<string, string[]>>;
    visibleOpNodeIds: ReadonlySet<string>;
}

// Resolves each label-matching source to its visible representative:
// itself if on-canvas, otherwise the anchor of its outermost collapsed
// ancestor. `visibleOpNodeIds` is the op-only id set — anchor and source
// ids are always op-node ids, so the group ids RF also carries are
// intentionally out of scope. Sources whose rep isn't visible are dropped.
export function resolveFilterMatches(inputs: FilterMatchInputs): FilterMatchResolution {
    const {
        testLabel,
        sources,
        expandedNamespaces,
        anchorByNamespace,
        containingNamespacesByNodeId,
        visibleOpNodeIds,
    } = inputs;

    const visibleRepIds = new Set<string>();
    const buriedCountByRepId = new Map<string, number>();
    let hiddenMatchCount = 0;

    for (const source of sources) {
        if (!testLabel(source.label)) {
            continue;
        }
        const containing = containingNamespacesByNodeId[source.id];
        let repId: string | null = null;
        if (containing && containing.length > 0) {
            for (const ns of containing) {
                if (!expandedNamespaces.has(ns)) {
                    const anchorId = anchorByNamespace[ns] ?? source.id;
                    repId = visibleOpNodeIds.has(anchorId) ? anchorId : null;
                    break;
                }
            }
        }
        if (repId === null) {
            repId = visibleOpNodeIds.has(source.id) ? source.id : null;
        }
        if (repId === null) {
            continue;
        }
        visibleRepIds.add(repId);
        if (repId !== source.id) {
            buriedCountByRepId.set(repId, (buriedCountByRepId.get(repId) ?? 0) + 1);
            hiddenMatchCount += 1;
        }
    }

    return { visibleRepIds, buriedCountByRepId, hiddenMatchCount };
}
