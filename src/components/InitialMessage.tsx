// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, Dialog, DialogBody, DialogFooter, Intent } from '@blueprintjs/core';
import { useState } from 'react';
import { IconNames } from '@blueprintjs/icons';
import getServerConfig from '../functions/getServerConfig';

const InitialMessage = () => {
    const [isDialogOpen, setIsDialogOpen] = useState(showInitialMessage());

    const handleCloseDialog = () => {
        setIsDialogOpen(false);
        sessionStorage.removeItem('displayInitialMessage');
    };

    return (
        <Dialog
            title='Welcome to TT-NN Visualizer'
            icon={IconNames.INFO_SIGN}
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
                    Visualisation of <a href='https://github.com/tenstorrent/tt-npe'>TT-NPE</a> data is also supported
                    and can be found in the NPE section of the app.
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
    );
};

const showInitialMessage = (): boolean => {
    const shouldDisplayInitialMessage = sessionStorage.getItem('displayInitialMessage') === 'true';

    if (!getServerConfig()?.SERVER_MODE) {
        return false;
    }

    return shouldDisplayInitialMessage;
};

export default InitialMessage;
