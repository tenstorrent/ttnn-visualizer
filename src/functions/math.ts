export const toHex = (num: number): string => {
    if (num < 0) {
        return toHex(0xffffffff + num + 1);
    }
    return `0x${num.toString(16).toUpperCase()}`;
};
