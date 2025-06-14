// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Callout, Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import LocalFolderSelector from '../components/report-selection/LocalFolderSelector';
import RemoteSyncConfigurator from '../components/report-selection/RemoteSyncConfigurator';
import 'styles/routes/Home.scss';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import getServerConfig from '../functions/getServerConfig';

function Home() {
    useClearSelectedBuffer();

    const disableRemoteSync = !!getServerConfig()?.SERVER_MODE;

    return (
        <div className='home'>
            <div className='folder-picker-options'>
                <fieldset>
                    <legend>Local folder</legend>

                    <Icon
                        icon={IconNames.FOLDER_OPEN}
                        size={150}
                    />

                    <div className='folder-picker-wrapper'>
                        <LocalFolderSelector />
                    </div>
                </fieldset>

                <fieldset>
                    <legend>Remote Sync</legend>

                    <Icon
                        icon={IconNames.CLOUD}
                        size={150}
                    />

                    <div className='folder-picker-wrapper'>
                        <RemoteSyncConfigurator />
                    </div>

                    {disableRemoteSync ? (
                        <div className='feature-disabled'>
                            <Callout
                                className='callout'
                                title='Feature unavailable'
                                icon={IconNames.WARNING_SIGN}
                                intent={Intent.WARNING}
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
            </div>
        </div>
    );
}

export default Home;
