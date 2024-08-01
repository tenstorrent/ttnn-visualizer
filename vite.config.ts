import { defineConfig } from 'vite';
import path, { join } from 'path';
import react from '@vitejs/plugin-react';
// @ts-expect-error don't have types declaration for node-build-scripts
import { sassNodeModulesLoadPaths } from '@blueprintjs/node-build-scripts';
// @ts-expect-error don't have types declaration for legacySassSvgInlinerFactory
import { legacySassSvgInlinerFactory } from './src/libs/blueprintjs/legacySassSvgInlinerFactory';

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
                functions: {
                    'svg-icon($path, $selectors: null)': legacySassSvgInlinerFactory(
                        join(__dirname, '/src/libs/blueprintjs/icons'),
                        {
                            optimize: true,
                            encodingFormat: 'uri',
                        },
                    ),
                },
                loadPaths: sassNodeModulesLoadPaths,
            },
        },
    },
    optimizeDeps: {
        include: ['css-select'],
    },
    build: {
        commonjsOptions : {
          include: [/css-select/, /node_modules/],
        },
    }
});
