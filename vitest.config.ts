// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { defineConfig, mergeConfig } from 'vitest/config';
import path from 'path';
import viteConfig from './vite.config';

export default defineConfig((configEnv) =>
    mergeConfig(
        viteConfig(configEnv),
        defineConfig({
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
        }),
    ),
);
