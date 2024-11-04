// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export const toHex = (num: number): string => {
    // eslint-disable-next-line no-bitwise
    return `0x${(num >>> 0).toString(16).toUpperCase()}`;
};

export const formatSize = (number: number): string => {
    return new Intl.NumberFormat('en-US').format(number);
};

export const prettyPrintAddress = (address: number | null, memorySize: number): string => {
    if (address === null) {
        return 'NULL';
    }

    return address.toString().padStart(memorySize.toString().length, '0');
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
