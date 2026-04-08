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

enum OutdatedLevel {
    NONE = 0,
    ONE = 1,
    TWO = 2,
    THREE = 3,
}

const OUTDATED_CLASS_MAP: Record<OutdatedLevel, string> = {
    [OutdatedLevel.NONE]: '',
    [OutdatedLevel.ONE]: 'is-outdated-one',
    [OutdatedLevel.TWO]: 'is-outdated-two',
    [OutdatedLevel.THREE]: 'is-outdated-three',
};

const PYPI_SOURCE_URL = 'https://pypi.org/project/ttnn-visualizer/';
const VERSION_ICON_SIZE = 14;

function AppVersionStatus({ appVersion, latestAppVersion }: AppVersionStatusProps) {
    const versionOutdatedLevel: OutdatedLevel = useMemo(
        () => (latestAppVersion ? getVersionOutdatedLevel(appVersion, latestAppVersion) : OutdatedLevel.NONE),
        [latestAppVersion, appVersion],
    );
    const isAppOutdated = versionOutdatedLevel > OutdatedLevel.NONE;
    const versionClasses = classNames('version-info', OUTDATED_CLASS_MAP[versionOutdatedLevel], {
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

const getVersionOutdatedLevel = (appVersion: string, latestAppVersion: string): OutdatedLevel => {
    if (!latestAppVersion || !appVersion) {
        return OutdatedLevel.NONE;
    }

    const current = semverParse(appVersion);
    const latest = semverParse(latestAppVersion);

    if (!current || !latest) {
        return OutdatedLevel.NONE;
    }

    const majorDiff = latest.major - current.major;
    const minorDiff = latest.minor - current.minor;
    const patchDiff = latest.patch - current.patch;

    if (majorDiff > 0) {
        return OutdatedLevel.THREE;
    }

    if (minorDiff === 1) {
        return OutdatedLevel.ONE;
    }
    if (minorDiff === 2) {
        return OutdatedLevel.TWO;
    }
    if (minorDiff > 2) {
        return OutdatedLevel.THREE;
    }

    return patchDiff > 0 ? OutdatedLevel.ONE : OutdatedLevel.NONE;
};

export default AppVersionStatus;
