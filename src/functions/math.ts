// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

const LOCALE = 'en-US';

export const toHex = (num: number): string => {
    // eslint-disable-next-line no-bitwise
    return `0x${(num >>> 0).toString(16).toUpperCase()}`;
};

export const formatSize = (number: number, decimals?: number): string => {
    return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: decimals }).format(number);
};

export const formatUnit = (
    value: number,
    unit: string,
    unitDisplay: Intl.NumberFormatOptions['unitDisplay'] = 'long',
): string => {
    return new Intl.NumberFormat(LOCALE, {
        style: 'unit',
        unit,
        unitDisplay,
    }).format(value);
};

export const formatPercentage = (number: number, decimals: number = 2): string =>
    new Intl.NumberFormat(LOCALE, {
        style: 'percent',
        unitDisplay: 'narrow',
        maximumFractionDigits: decimals,
    }).format(number / 100);

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

// Pretty print an address, with option to display in hex or decimal, and pad with leading zeros based on memory size
export const prettyPrintAddress = (address: number | null, memorySize: number, isHex: boolean = false): string => {
    if (address === null) {
        return 'NULL';
    }

    if (isHex) {
        // eslint-disable-next-line no-bitwise
        const hexStr = (address >>> 0).toString(16).toUpperCase();
        // eslint-disable-next-line no-bitwise
        const maxHexLength = (memorySize >>> 0).toString(16).length;
        return `0x${hexStr.padStart(maxHexLength, '0')}`;
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

export interface CoreCoord {
    x: number;
    y: number;
}

const CORE_RANGE_RECT_RE = /\[([^\]]+)\]/g;
const CORE_COORD_RE = /\(x=(\d+),y=(\d+)\)|(\d+)-(\d+)/g;

/**
 * Expand a core_range_set string to the deduplicated list of (x,y) cores it covers.
 * Accepts both `{[(x=N,y=N) - (x=N,y=N)]}` (legacy) and `{[N-N - N-N]}` (modern),
 * multi-rectangle unions, and `{}`.
 */
export const getCoresInRangeList = (rangeString: string): CoreCoord[] => {
    const cores = new Map<string, CoreCoord>();
    for (const rect of rangeString.matchAll(CORE_RANGE_RECT_RE)) {
        const corners: CoreCoord[] = [];
        for (const m of rect[1].matchAll(CORE_COORD_RE)) {
            const x = m[1] !== undefined ? Number(m[1]) : Number(m[3]);
            const y = m[2] !== undefined ? Number(m[2]) : Number(m[4]);
            corners.push({ x, y });
            if (corners.length === 2) {
                break;
            }
        }
        if (corners.length !== 2) {
            continue; // eslint-disable-line no-continue
        }
        const [a, b] = corners;
        const xMin = Math.min(a.x, b.x);
        const xMax = Math.max(a.x, b.x);
        const yMin = Math.min(a.y, b.y);
        const yMax = Math.max(a.y, b.y);
        for (let x = xMin; x <= xMax; x += 1) {
            for (let y = yMin; y <= yMax; y += 1) {
                const k = `${x},${y}`;
                if (!cores.has(k)) {
                    cores.set(k, { x, y });
                }
            }
        }
    }
    return Array.from(cores.values());
};

export const getCoresInRange = (rangeString: string): number => getCoresInRangeList(rangeString).length;

/**
 * Convert bytes to human-readable format using binary units (1024-based)
 * Appropriate for memory sizes (L1, DRAM, etc.) as memory is organized in powers of 2
 * @param bytes - The number of bytes to convert
 * @param decimals - Number of decimal places (default: 0 for B/KiB, 2 for MiB+)
 * @example convertBytes(1024) // "1 KiB"
 * @example convertBytes(163840) // "160 KiB"
 * @example convertBytes(22370304) // "21.33 MiB"
 */
export const formatMemorySize = (bytes: number | undefined, decimals = 0): string => {
    const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

    if (bytes === undefined) {
        return 'N/A';
    }

    if (bytes === 0) {
        return `0 ${sizes[0]}`;
    }

    if (bytes < 1) {
        return `${formatSize(bytes, decimals)} ${sizes[0]}`;
    }

    const maxIndex = sizes.length - 1;
    const denominationIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), maxIndex);
    const fractionDigits = denominationIndex > 1 ? 2 : decimals; // MiB and up always requires decimals
    const value = formatSize(bytes / 1024 ** denominationIndex, fractionDigits);

    return `${value} ${sizes[denominationIndex]}`;
};

// Formats a memory address to a string with optional hex formatting
export const getMemoryAddress = (address: number | null, showHex: boolean): string => {
    if (address === null) {
        return 'NULL';
    }

    return showHex ? toHex(address) : address.toString();
};
