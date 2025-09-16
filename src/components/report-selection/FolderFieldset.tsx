// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Icon, Intent } from '@blueprintjs/core';
import { IconName } from '@blueprintjs/icons';
import React from 'react';
import 'styles/components/FolderFieldset.scss';

interface FolderFieldsetProps {
    title: string;
    icon: IconName;
    isFeatureDisabled?: boolean;
    children: React.ReactNode;
}

const FolderFieldset = ({ title, icon, isFeatureDisabled = false, children }: FolderFieldsetProps) => {
    return (
        <fieldset className='folder-fieldset'>
            <legend>
                <h2 className='legend-title'>{title}</h2>
            </legend>

            <Icon
                className='legend-icon'
                icon={icon}
                size={150}
            />

            <div className='folder-picker-wrapper'>{children}</div>

            {isFeatureDisabled ? (
                <div
                    className='feature-disabled'
                    data-testid='remote-sync-disabled'
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
