// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const toHex = (num: number): string => {
    // eslint-disable-next-line no-bitwise
    return `0x${(num >>> 0).toString(16).toUpperCase()}`;
};

export const formatSize = (number: number, decimals?: number): string => {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(number);
};

/**
 * Convert microseconds to seconds and format it to 3 decimal places
 * returns empty string if us is less than min
 */
export const toSecondsPretty = (us: number, min: number = 1000): string => {
    if (us < min) {
        return '';
    }
    return `( ${(us / 1_000_000).toFixed(3)}s )`;
};

export const prettyPrintAddress = (address: number | null, memorySize: number): string => {
    if (address === null) {
        return 'NULL';
    }

    return address.toString().padStart(memorySize?.toString().length, '0');
};

type Primitive = string | number | boolean | null | undefined;

interface ComparableObject {
    [key: string]: ComparableValue;
}

type ComparableValue = Primitive | ComparableObject | ComparableValue[];

export const isEqual = <T>(value: T, other: T): boolean => {
    if (value === other) {
        return true;
    }

    if (typeof value !== typeof other) {
        return false;
    }

    if (value === null || other === null) {
        return false;
    }

    if (typeof value !== 'object') {
        return Object.is(value, other);
    }

    if (Array.isArray(value) && Array.isArray(other)) {
        if (value.length !== other.length) {
            return false;
        }

        return value.every((item, index) => isEqual(item, other[index]));
    }

    if (Array.isArray(value) || Array.isArray(other)) {
        return false;
    }

    const valueObj = value as ComparableObject;
    const otherObj = other as ComparableObject;

    const valueKeys = Object.keys(valueObj);
    const otherKeys = Object.keys(otherObj);

    if (valueKeys.length !== otherKeys.length) {
        return false;
    }

    return valueKeys.every((key) => {
        if (!(key in otherObj)) {
            return false;
        }
        return isEqual(valueObj[key], otherObj[key]);
    });
};
export const toReadableShape = (input: string) => {
    const match = input.match(/Shape\((\[.*\])\)/);
    if (!match) {
        return input;
    }
    return match[1];
};
export const toReadableType = (input: string) => {
    return input.replace(/^DataType\./, '');
};

/**
 @description Count the number of cores in a range string
 @param {string} rangeString - The range string to parse {[(x=0,y=0) - (x=7,y=7)]}
 @returns {number} The number of cores
 */
export const getCoresInRange = (rangeString: string): number => {
    const regex = /\(x=(\d+),y=(\d+)\)/g;
    const matches = [...rangeString.matchAll(regex)];

    if (matches.length !== 2) {
        return 0;
    }

    const [x1, y1] = matches[0].slice(1).map(Number);
    const [x2, y2] = matches[1].slice(1).map(Number);

    return (x2 - x1 + 1) * (y2 - y1 + 1);
};
