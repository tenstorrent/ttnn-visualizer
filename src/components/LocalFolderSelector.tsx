// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FormGroup } from '@blueprintjs/core';
import type { FC } from 'react';
import GraphSelector from './GraphSelector';
import FolderPicker from './FolderPicker';

import 'styles/components/FolderPicker.scss';

// const getTestName = (path: string) => {
//     const lastFolder = path.split(pathSeparator).pop();
//     return lastFolder || undefined;
// };

const LocalFolderOptions: FC = () => {
    // const { loadPerfAnalyzerFolder, openPerfAnalyzerFolderDialog, error, loadPerfAnalyzerGraph } =
    //     usePerfAnalyzerFileLoader();
    // const localFolderPath = useSelector(getFolderPathSelector);
    // const selectedFolderLocationType = useSelector(getSelectedFolderLocationType);
    const localFolderPath = './';
    const selectedFolderLocationType = 'local';

    return (
        <FormGroup
            label={<h3>Select local folder</h3>}
            labelFor='text-input'
            subLabel='Select local folder to load netlist analyzer output and performance data from'
        >
            <div className='buttons-container'>
                <FolderPicker
                    // onSelectFolder={async () => {
                    //     const folderPath = await openPerfAnalyzerFolderDialog();

                    //     await loadPerfAnalyzerFolder(folderPath);

                    //     if (folderPath) {
                    //         sendEventToMain(
                    //             ElectronEvents.UPDATE_WINDOW_TITLE,
                    //             `(Local Folder) — ${getTestName(folderPath)}`,
                    //         );
                    //     }
                    // }}
                    onSelectFolder={() => {}}
                    // text={selectedFolderLocationType === 'local' ? getTestName(localFolderPath) : undefined}
                    text={undefined}
                />
                <GraphSelector
                    onSelectGraph={() => {}}
                    // onSelectGraph={(graph) => loadPerfAnalyzerGraph(graph)}
                    // disabled={selectedFolderLocationType === 'remote'}
                />
                {/* {error && (
                    <div className='loading-error'>
                        <p>{error.toString()}</p>
                    </div>
                )} */}
            </div>
        </FormGroup>
    );
};

export default LocalFolderOptions;
