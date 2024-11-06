// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { toast } from 'react-toastify';
import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import LocalFolderSelector from '../components/report-selection/LocalFolderSelector';
import RemoteSyncConfigurator from '../components/report-selection/RemoteSyncConfigurator';
import 'styles/routes/Home.scss';

function Home() {
    // Dismiss any toasts that are open
    toast.dismiss();

    return (
        <div className='splash-screen home'>
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
                </fieldset>
            </div>
        </div>
    );
}

export default Home;
