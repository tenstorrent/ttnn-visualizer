export const toHex = (num: number): string => {
    if (num < 0) {
        return toHex(0xffffffff + num + 1);
    }
    return `0x${num.toString(16).toUpperCase()}`;
};

export const formatSize = (number: number): string => {
    return new Intl.NumberFormat('en-US').format(number);
};

export const prettyPrintAddress = (address: number, memorySize: number): string => {
    return address.toString().padStart(memorySize.toString().length, '0');
};
