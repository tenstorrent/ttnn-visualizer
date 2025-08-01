// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

const colorList = [
    'rgb(63,181,143)',
    'rgb(74,217,225)',
    'rgb(247,66,78)',
    'rgb(52,163,188)',
    'rgb(113,168,31)',
    'rgb(95,188,255)',
    'rgb(96,157,255)',
    'rgb(152,218,29)',
    'rgb(187,141,255)',
    'rgb(136,217,141)',
    'rgb(226,177,30)',
    'rgb(255,137,229)',
    'rgb(190,39,130)',
    'rgb(252,194,251)',
    'rgb(209,109,255)',
    'rgb(158,183,229)',
    'rgb(201,151,13)',
    'rgb(250,163,140)',
    'rgb(255,92,111)',
    'rgb(247,147,30)',
    'rgb(227,215,105)',
    'rgb(90,51,137)',
    'rgb(23,244,111)',
];

function* colorGenerator(): IterableIterator<string> {
    let i = 0;
    while (true) {
        yield colorList[i];
        i = (i + 1) % colorList.length;
    }
}

const getNextGroupColor = colorGenerator();
const bufferColorCache = new Map<number, string>();

export const getBufferColor = (address: number | null): string | undefined => {
    if (address === null) {
        return 'rgb(255,255,255)';
    }
    if (!bufferColorCache.has(address)) {
        bufferColorCache.set(address, getNextGroupColor.next().value);
    }
    return bufferColorCache.get(address);
};
const tensorNextColor = colorGenerator();
const tensorColorCache = new Map<number, string>();

export const getTensorColor = (tensorId: number | undefined): string | undefined => {
    if (tensorId === undefined) {
        return undefined;
    }
    if (!tensorColorCache.has(tensorId)) {
        tensorColorCache.set(tensorId, tensorNextColor.next().value);
    }
    return tensorColorCache.get(tensorId);
};
