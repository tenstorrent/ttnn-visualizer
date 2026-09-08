// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** Shared collection + namespace utilities used across the MLIR graph pipeline. */

/**
 * Append `value` to the list at `key`, creating the list lazily. Avoids the
 * `?? []` + always-set dance, and the redundant `map.set` call on the hot path
 * where the key already exists.
 */
export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const arr = map.get(key);
    if (arr) {
        arr.push(value);
    } else {
        map.set(key, [value]);
    }
}

export const getNamespaceSegments = (namespace?: string): string[] =>
    namespace ? namespace.split('/').filter(Boolean) : [];

export const getShortName = (namespace: string): string => {
    const parts = getNamespaceSegments(namespace);
    return parts[parts.length - 1] ?? namespace;
};

export const getParentNamespace = (namespace: string): string | undefined => {
    const parts = getNamespaceSegments(namespace);
    if (parts.length <= 1) {
        return undefined;
    }
    return parts.slice(0, -1).join('/');
};
