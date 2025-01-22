export const isDeviceOperation = (name: string): boolean =>
    !name.includes('(torch)') && !name.includes('::') && !name.includes('ttnn.') && name !== '';
