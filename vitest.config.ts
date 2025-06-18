import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        setupFiles: ['./vitest.setup.ts'],
        environment: 'jsdom',
        deps: {
            optimizer: {
                web: {
                    include: ['vitest-canvas-mock'],
                },
            },
        },
        poolOptions: {
            threads: {
                singleThread: true,
            },
        },
        environmentOptions: {
            jsdom: {
                resources: 'usable',
            },
        },
        alias: {
            'styles/': `${path.resolve(__dirname, 'src/scss')}/`,
            '@blueprintjs': path.resolve(__dirname, './node_modules/@blueprintjs'),
        },
    },
});
