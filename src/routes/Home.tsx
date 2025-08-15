// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { IconNames } from '@blueprintjs/icons';
import LocalFolderSelector from '../components/report-selection/LocalFolderSelector';
import RemoteSyncConfigurator from '../components/report-selection/RemoteSyncConfigurator';
import 'styles/routes/Home.scss';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import getServerConfig from '../functions/getServerConfig';
import InitialMessage from '../components/InitialMessage';
import FolderFieldset from '../components/report-selection/FolderFieldset';

function Home() {
    useClearSelectedBuffer();

    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const isDirectReportMode = !!getServerConfig()?.TT_METAL_HOME;

    return (
        <div className='home'>
            <div className='folder-picker-options'>
                <FolderFieldset
                    title='Local folder'
                    icon={IconNames.FOLDER_OPEN}
                >
                    <LocalFolderSelector />
                </FolderFieldset>

                <FolderFieldset
                    title='Remote sync'
                    icon={IconNames.CLOUD}
                    isFeatureDisabled={isServerMode || isDirectReportMode}
                >
                    <RemoteSyncConfigurator />
                </FolderFieldset>
            </div>

            {isServerMode && <InitialMessage />}
        </div>
    );
}

export default Home;
