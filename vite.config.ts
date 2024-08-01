import { defineConfig } from 'vite';
import path, { join } from 'path';
import react from '@vitejs/plugin-react';
// @ts-expect-error don't have types declaration for node-build-scripts
import { sassNodeModulesLoadPaths } from '@blueprintjs/node-build-scripts';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        open: true,
        proxy: {
            '/api': 'http://localhost:8000',
        },
    },
    resolve: {
        alias: {
            'styles/': `${path.resolve(__dirname, 'src/scss')}/`,
            '@blueprintjs': path.resolve(__dirname, './node_modules/@blueprintjs'),
        },
    },
    css: {
        devSourcemap: true,
        preprocessorOptions: {
            scss: {
                loadPaths: sassNodeModulesLoadPaths,
            },
        },
    },
    optimizeDeps: {
        include: ['css-select'],
    },
    build: {
        commonjsOptions: {
            include: [/css-select/, /node_modules/],
        },
    },
});
