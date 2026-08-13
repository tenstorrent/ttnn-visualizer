// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from 'react';
import 'styles/components/ServerModeBanner.scss';
import getServerConfig from '../functions/getServerConfig';
import { TEST_IDS } from '../definitions/TestIds';

// How close to the top of the viewport the pointer has to come before the banner
// reveals itself.
const REVEAL_THRESHOLD_PX = 80;

/**
 * Points hosted visitors at the installable build. Lives beside the navigation rather
 * than inside it so that switching menu styles can't take the hosted deployment's only
 * signpost with it.
 */
function ServerModeBanner() {
    const serverMode = getServerConfig().SERVER_MODE;
    const [isRevealed, setIsRevealed] = useState(false);

    useEffect(() => {
        if (!serverMode) {
            return () => {};
        }

        const handleMouseMove = (e: MouseEvent) => {
            setIsRevealed(e.clientY < REVEAL_THRESHOLD_PX);
        };

        window.addEventListener('mousemove', handleMouseMove);
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
                href='https://pypi.org/project/ttnn-visualizer/'
                target='_blank'
                rel='noreferrer'
            >
                PyPI
            </a>
            or head over to{' '}
            <a
                href='https://github.com/tenstorrent/ttnn-visualizer'
                target='_blank'
                rel='noreferrer'
            >
                GitHub
            </a>
        </div>
    );
}

export default ServerModeBanner;
