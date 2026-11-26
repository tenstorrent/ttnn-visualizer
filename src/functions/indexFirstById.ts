// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** Index items by a numeric id. The first item per id wins when ids repeat. */
const indexFirstById = <T>(items: T[] | undefined, getId: (item: T) => number): Map<number, T> => {
    const itemById = new Map<number, T>();

    for (const item of items ?? []) {
        const id = getId(item);

        if (!itemById.has(id)) {
            itemById.set(id, item);
        }
    }

    return itemById;
};

export default indexFirstById;
