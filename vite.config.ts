// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';
// @ts-expect-error don't have types declaration for sassOptions
import { createSassOptions } from './src/libs/blueprintjs/sassOptions.js';
import packageJson from './package.json' with { type: 'json' };

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
    return {
        build: {
            // One CSS bundle for production; avoid per-async-chunk CSS splits alongside lazy routes.
            cssCodeSplit: false,
            outDir: './backend/ttnn_visualizer/static/',
            emptyOutDir: true,
            target: 'es2022',
            sourcemap: false,
            reportCompressedSize: false,
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (!id.includes('node_modules')) {
                            return undefined;
                        }
                        if (id.includes('plotly.js') || id.includes('react-plotly.js')) {
                            return 'plotly';
                        }
                        if (
                            id.includes('vis-network') ||
                            id.includes('node_modules/vis-data') ||
                            id.includes('node_modules\\vis-data')
                        ) {
                            return 'vis';
                        }
                        if (id.includes('@xyflow')) {
                            return 'xyflow';
                        }
                        if (id.includes('@blueprintjs')) {
                            return 'blueprint';
                        }
                        return undefined;
                    },
                },
            },
        },
        base: command === 'serve' ? '/' : '/static/',
        define: {
            'import.meta.env.APP_VERSION': JSON.stringify(packageJson.version),
        },
        plugins: [react()],
        server: {
            proxy: {
                '/api': 'http://localhost:8000',
                '/socket.io': {
                    target: 'http://localhost:8000',
                    ws: true,
                },
            },
        },
        resolve: {
            alias: {
                'styles/': `${path.resolve(import.meta.dirname, 'src/scss')}/`,
                '@blueprintjs': path.resolve(import.meta.dirname, './node_modules/@blueprintjs'),
            },
        },
        css: {
            devSourcemap: true,
            preprocessorOptions: {
                scss: createSassOptions(import.meta.dirname),
            },
        },
    };
});
