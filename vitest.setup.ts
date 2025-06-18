import { vi } from 'vitest';
import 'vitest-canvas-mock';

if (!window.URL) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.URL = {} as any;
}
window.URL.createObjectURL = vi.fn();
