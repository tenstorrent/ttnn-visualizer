// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { defineConfig, loadEnv } from 'vite';
import path, { join } from 'path';
import react from '@vitejs/plugin-react';
// @ts-expect-error don't have types declaration for node-build-scripts
import { sassNodeModulesLoadPaths } from '@blueprintjs/node-build-scripts';
// @ts-expect-error don't have types declaration for legacySassSvgInlinerFactory
import { legacySassSvgInlinerFactory } from './src/libs/blueprintjs/legacySassSvgInlinerFactory';
import { version } from './package.json';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    return {
        build: {
            outDir: './backend/ttnn_visualizer/static/',
            emptyOutDir: true,
        },
        define: {
            'import.meta.env.APP_VERSION': JSON.stringify(version),
            'import.meta.env.VITE_API_ROOT': JSON.stringify(env.VITE_API_ROOT) ?? '"http://localhost:8000/api"',
            'import.meta.env.VITE_SERVER_MODE': JSON.stringify(env.VITE_SERVER_MODE) ?? null,
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
                    silenceDeprecations: ['legacy-js-api'], // Ignoring warnings relating to BlueprintJS - revisit if we upgrade Vite/BlueprintJS/Sass
                    quietDeps: true, // Ignoring warnings relating to BlueprintJS - revisit if we upgrade Vite/BlueprintJS/Sass
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
