// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import LocalFolderSelector from '../components/report-selection/LocalFolderSelector';
import RemoteSyncConfigurator from '../components/report-selection/RemoteSyncConfigurator';
import 'styles/routes/Home.scss';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import getServerConfig from '../functions/getServerConfig';
import InitialMessage from '../components/InitialMessage';

function Home() {
    useClearSelectedBuffer();

    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const isTtMetalMode = !!getServerConfig()?.TT_METAL_HOME;

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

                    {isServerMode || isTtMetalMode ? (
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
            </div>

            {isServerMode && <InitialMessage />}
        </div>
    );
}

export default Home;
