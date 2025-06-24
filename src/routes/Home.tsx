// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { Button, Callout, Dialog, DialogBody, DialogFooter, Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import LocalFolderSelector from '../components/report-selection/LocalFolderSelector';
import RemoteSyncConfigurator from '../components/report-selection/RemoteSyncConfigurator';
import 'styles/routes/Home.scss';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import getServerConfig from '../functions/getServerConfig';

function Home() {
    useClearSelectedBuffer();

    const [isDialogOpen, setIsDialogOpen] = useState(!shouldHideStartup());

    const disableRemoteSync = !!getServerConfig()?.SERVER_MODE;
    const isDialogEnabled = !!getServerConfig()?.SERVER_MODE;

    const handleCloseDialog = () => {
        createHideStartupCookie();
        setIsDialogOpen(false);
    };

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
                        <div
                            className='feature-disabled'
                            data-testid='remote-sync-disabled'
                        >
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

            {isDialogEnabled && (
                <Dialog
                    title='Welcome to TT-NN Visualizer'
                    icon='info-sign'
                    isOpen={isDialogOpen}
                    usePortal={false}
                    onClose={handleCloseDialog}
                >
                    <DialogBody>
                        <p>
                            Choose from our demo reports or upload your own generated with{' '}
                            <a href='https://github.com/tenstorrent/tt-metal/'>TT-Metal</a> to visualize the data.
                        </p>

                        <p>
                            Visualisation of <a href='https://github.com/tenstorrent/tt-npe'>TT-NPE</a> data is also
                            supported and can be found in the NPE section of the app.
                        </p>
                    </DialogBody>

                    <DialogFooter
                        actions={
                            <Button
                                intent={Intent.PRIMARY}
                                text='Close'
                                onClick={handleCloseDialog}
                            />
                        }
                    />
                </Dialog>
            )}
        </div>
    );
}

const shouldHideStartup = (): boolean => {
    const match = document.cookie.match(/(?:^|;\s*)hide-startup-information=([^;]*)/);

    if (!getServerConfig()?.SERVER_MODE) {
        return false;
    }

    return match ? match[1] === 'true' : false;
};

const createHideStartupCookie = () => {
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    document.cookie = `hide-startup-information=true; expires=${expires.toUTCString()}; path=/`;
};

export default Home;
