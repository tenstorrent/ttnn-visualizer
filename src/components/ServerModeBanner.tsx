// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from 'react';
import 'styles/components/ServerModeBanner.scss';
import getServerConfig from '../functions/getServerConfig';
import { TEST_IDS } from '../definitions/TestIds';

// How close to the top of the viewport the pointer has to come before the banner
// reveals itself.
const REVEAL_THRESHOLD_PX = 80;

export const PYPI_PACKAGE_URL = 'https://pypi.org/project/ttnn-visualizer/';
export const GITHUB_REPOSITORY_URL = 'https://github.com/tenstorrent/ttnn-visualizer';

/**
 * Points hosted visitors at the installable build. Lives beside the navigation rather
 * than inside it so that restyling the navigation can't take the hosted deployment's
 * only signpost with it.
 */
function ServerModeBanner() {
    const serverMode = getServerConfig().SERVER_MODE;
    const [isRevealed, setIsRevealed] = useState(false);
    const isRevealedRef = useRef(false);

    useEffect(() => {
        if (!serverMode) {
            return () => {};
        }

        const handleMouseMove = (e: MouseEvent) => {
            const shouldReveal = e.clientY < REVEAL_THRESHOLD_PX;

            // This runs at pointer rate on `window`, sharing that path with the graph views'
            // pan/zoom and the chart hover handlers, so it only reaches React on a crossing
            // of the threshold rather than on every move.
            if (shouldReveal === isRevealedRef.current) {
                return;
            }

            isRevealedRef.current = shouldReveal;
            setIsRevealed(shouldReveal);
        };

        window.addEventListener('mousemove', handleMouseMove, { passive: true });
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [serverMode]);

    if (!serverMode) {
        return null;
    }

    return (
        <div
            className='server-mode-banner'
            data-testid={TEST_IDS.SERVER_MODE_BANNER}
            style={{
                transform: isRevealed ? 'translateY(0)' : 'translateY(-100%)',
            }}
        >
            For full featured application, please install from
            <a
                href={PYPI_PACKAGE_URL}
                target='_blank'
                rel='noreferrer'
            >
                PyPI
            </a>
            or head over to{' '}
            <a
                href={GITHUB_REPOSITORY_URL}
                target='_blank'
                rel='noreferrer'
            >
                GitHub
            </a>
        </div>
    );
}

export default ServerModeBanner;
