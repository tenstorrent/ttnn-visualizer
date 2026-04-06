// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Icon, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useMemo } from 'react';
import { semverParse } from '../functions/semverParse';
import 'styles/components/AppVersionStatus.scss';

interface AppVersionStatusProps {
    appVersion: string;
    latestAppVersion: string;
}

const PYPI_SOURCE_URL = 'https://pypi.org/project/ttnn-visualizer/';
const VERSION_ICON_SIZE = 14;

function AppVersionStatus({ appVersion, latestAppVersion }: AppVersionStatusProps) {
    const versionOutdatedLevel: number = useMemo(
        () => (latestAppVersion ? getVersionOutdatedLevel(appVersion, latestAppVersion) : 0),
        [latestAppVersion, appVersion],
    );
    const isAppOutdated = versionOutdatedLevel > 0;
    const versionClasses = classNames('version-info', getOutdatedClass(versionOutdatedLevel), {
        'is-anchor': isAppOutdated,
    });

    return (
        <Tooltip
            content={isAppOutdated ? `App update available: v${latestAppVersion}` : 'TT-NN Visualizer is up to date'}
            position={PopoverPosition.TOP}
        >
            {isAppOutdated ? (
                <a
                    href={`${PYPI_SOURCE_URL}${latestAppVersion}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-label='Update available'
                    className={versionClasses}
                >
                    <Icon
                        className='version-status-icon'
                        icon={IconNames.OUTDATED}
                        size={VERSION_ICON_SIZE}
                    />
                    <span className='app-version'>v{appVersion}</span>
                </a>
            ) : (
                <div className={versionClasses}>
                    <Icon
                        className='version-status-icon'
                        icon={IconNames.TICK}
                        size={VERSION_ICON_SIZE}
                    />
                    <span className='app-version'>v{appVersion}</span>
                </div>
            )}
        </Tooltip>
    );
}

const getVersionOutdatedLevel = (appVersion: string, latestAppVersion: string): number => {
    if (!latestAppVersion || !appVersion) {
        return 0;
    }

    const current = semverParse(appVersion);
    const latest = semverParse(latestAppVersion);

    if (!current || !latest) {
        return 0;
    }

    const majorDiff = latest.major - current.major;
    const minorDiff = latest.minor - current.minor;
    const patchDiff = latest.patch - current.patch;

    if (majorDiff > 0) {
        // If major version is behind, count as at least 100 (high level)
        return Math.max(100 + minorDiff * 10 + patchDiff, 100);
    }

    if (minorDiff > 0) {
        // One minor -> yellow (2)
        // Two minors -> orange (10-19)
        // Three+ minors -> red (30+)
        if (minorDiff === 1) {
            return 2;
        }
        return (minorDiff - 2) * 20 + 10 + Math.max(patchDiff, 0);
    }

    // Only patch version difference matters if major and minor are same
    return Math.max(patchDiff, 0);
};

const getOutdatedClass = (versionOutdatedLevel: number): string => {
    if (versionOutdatedLevel === 0) {
        return '';
    }
    if (versionOutdatedLevel <= 2) {
        return 'is-outdated-one';
    }
    if (versionOutdatedLevel <= 20) {
        return 'is-outdated-two';
    }

    return 'is-outdated-three';
};

export default AppVersionStatus;
