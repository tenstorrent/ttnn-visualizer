// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { defineConfig } from 'vite';
import path, { join } from 'path';
import react from '@vitejs/plugin-react';
// @ts-expect-error don't have types declaration for node-build-scripts
import { sassNodeModulesLoadPaths } from '@blueprintjs/node-build-scripts';
// @ts-expect-error don't have types declaration for legacySassSvgInlinerFactory
import { legacySassSvgInlinerFactory } from './src/libs/blueprintjs/legacySassSvgInlinerFactory';
import { version } from './package.json';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
    return {
        build: {
            outDir: './backend/ttnn_visualizer/static/',
            emptyOutDir: true,
        },
        base: command === 'serve' ? '/' : '/static/',
        define: {
            'import.meta.env.APP_VERSION': JSON.stringify(version),
        },
        plugins: [react()],
        server: {
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
                    quietDeps: true, // Ignoring warnings relating to BlueprintJS - revisit if we upgrade it
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
    };
});
