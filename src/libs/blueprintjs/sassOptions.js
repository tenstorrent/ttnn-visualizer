// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { join } from 'path';
import { sassNodeModulesLoadPaths } from '@blueprintjs/node-build-scripts';
import { legacySassSvgInlinerFactory } from './legacySassSvgInlinerFactory.js';

/**
 * Sass options for compiling the app's stylesheets against Blueprint's Sass sources. Vite builds with
 * these, and tests that compile the stylesheets use them too so they check the CSS that ships.
 */
export const createSassOptions = (rootDirectory) => ({
    // Blueprint's Sass still uses @import and global built-in functions, so without this its deprecation
    // warnings bury our own. Still needed as of Blueprint 6.21.
    quietDeps: true,
    functions: {
        'svg-icon($path, $selectors: null)': legacySassSvgInlinerFactory(
            join(rootDirectory, 'src/libs/blueprintjs/icons'),
            {
                optimize: true,
                encodingFormat: 'uri',
            },
        ),
    },
    loadPaths: sassNodeModulesLoadPaths,
});
