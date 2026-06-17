// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Icon, Intent } from '@blueprintjs/core';
import { IconName } from '@blueprintjs/icons';
import React from 'react';
import 'styles/components/FolderFieldset.scss';
import { TEST_IDS } from '../../definitions/TestIds';

interface FolderFieldsetProps {
    title: string;
    icon: IconName;
    isBeta?: boolean;
    isFeatureDisabled?: boolean;
    disabledTestId?: string;
    children: React.ReactNode;
}

const FolderFieldset = ({
    title,
    icon,
    isBeta = false,
    isFeatureDisabled = false,
    disabledTestId = TEST_IDS.REMOTE_SYNC_DISABLED,
    children,
}: FolderFieldsetProps) => {
    return (
        <fieldset className='folder-fieldset'>
            <legend>
                <h2 className='legend-title'>
                    {title}
                    {isBeta ? <small className='legend-beta'>beta</small> : null}
                </h2>
            </legend>

            <Icon
                className='legend-icon'
                icon={icon}
                size={90}
            />

            <div className='folder-picker-wrapper'>{children}</div>

            {isFeatureDisabled ? (
                <div
                    className='feature-disabled'
                    data-testid={disabledTestId}
                >
                    <Callout
                        className='callout'
                        title='Feature unavailable'
                        intent={Intent.NONE}
                    >
                        <p>
                            This feature is not available in the server version of the app. Download{' '}
                            <a
                                href='https://github.com/tenstorrent/ttnn-visualizer/'
                                target='_blank'
                                rel='noreferrer'
                            >
                                TT-NN Visualizer
                            </a>{' '}
                            to access this feature.
                        </p>
                    </Callout>
                </div>
            ) : null}
        </fieldset>
    );
};

export default FolderFieldset;
