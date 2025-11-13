/* eslint-disable react/jsx-props-no-spreading */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    Button,
    ButtonGroup,
    ButtonVariant,
    FormGroup,
    InputGroup,
    Intent,
    PopoverPosition,
    Size,
    Switch,
    Tag,
    Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Helmet } from 'react-helmet-async';
import { useState } from 'react';
import { useAtom } from 'jotai';
import ConnectionTestMessage from '../components/report-selection/ConnectionTestMessage';
import { ConnectionTestStates } from '../definitions/ConnectionStatus';
import ProgressBar from '../components/ProgressBar';
import SearchField from '../components/SearchField';
import 'styles/routes/Styleguide.scss';
import LoadingSpinner from '../components/LoadingSpinner';
import GlobalSwitch from '../components/GlobalSwitch';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import MemoryTag from '../components/MemoryTag';
import FileStatusOverlay from '../components/FileStatusOverlay';
import { fileTransferProgressAtom } from '../store/app';
import { FileStatus } from '../model/APIData';
import NPEProcessingStatus from '../components/NPEProcessingStatus';
import { MIN_NPE_DATA_VERSION, getNpeDataErrorType } from '../definitions/NPEData';

const FORM_GROUP = {
    label: 'Form label',
    subLabel: 'Sub label here',
};

const FILE_DOWNLOAD_IN_PROGRESS = {
    currentFileName: 'example_test_file_1.txt',
    numberOfFiles: 3,
    percentOfCurrent: 25,
    finishedFiles: 1,
    status: FileStatus.DOWNLOADING,
};

const FILE_DOWNLOAD_INACTIVE = {
    currentFileName: '',
    numberOfFiles: 0,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.INACTIVE,
};

const TIME_REMAINING_INTERVAL = 100;

export default function Styleguide() {
    const [updateFileTransferProgress, setUpdateFileTransferProgress] = useAtom(fileTransferProgressAtom);
    const [autoCloseTime, setAutoCloseTime] = useState(1000);
    const [timeRemaining, setTimeRemaining] = useState(autoCloseTime);

    const handleUpdateFileTransferProgress = () => {
        setUpdateFileTransferProgress(FILE_DOWNLOAD_IN_PROGRESS);
        setTimeRemaining(autoCloseTime);

        const calculateRemainingTime = setInterval(() => {
            setTimeRemaining((prev) => prev - TIME_REMAINING_INTERVAL);
        }, TIME_REMAINING_INTERVAL);

        setTimeout(() => {
            setUpdateFileTransferProgress(FILE_DOWNLOAD_INACTIVE);
            clearInterval(calculateRemainingTime);
            setTimeRemaining(autoCloseTime);
        }, autoCloseTime);
    };

    useClearSelectedBuffer();

    return (
        <>
            <Helmet title='Styleguide' />

            <h2>Typography</h2>
            {/*

            <p>
                <strong>Font family</strong>
            </p>

            <p>Arial Nova, Arial, sans-serif</p>

            <h1>Heading H1</h1>
            <h2>Heading H2</h2>
            <h3>Heading H3</h3>
            <h4>Heading H4</h4>
            <h5>Heading H5</h5> */}

            <div className='container'>
                <h3>Paragraph</h3>

                <p>
                    Lorem ipsum dolor sit amet <em>consectetur adipisicing</em> elit. Error laborum atque suscipit.
                    Officiis fugit necessitatibus libero <strong>perspiciatis sequi </strong>accusantium earum{' '}
                    <a href='#123'>repudiandae deserunt</a> nemo, <u>voluptatem tempora</u> laborum eaque minima
                    molestiae eveniet.
                </p>

                <h3>Monospace</h3>

                <p className='monospace'>
                    Lorem ipsum dolor sit, amet consectetur adipisicing elit. Magni nemo velit molestias quae temporibus
                    sint in at consectetur voluptatem obcaecati, saepe, ratione, reprehenderit perferendis quas
                    explicabo error repellendus deserunt? Optio!
                </p>

                <h3>Horizontal ruler</h3>

                <hr />
            </div>

            <h2>Colours</h2>

            <div className='container flex wrap'>
                <div className='container colour-container flex no-gap flex-column'>
                    <p>Grey</p>
                    <div className='colour w-1' />
                    <div className='colour g-6' />
                    <div className='colour g-5' />
                    <div className='colour g-4' />
                    <div className='colour g-3' />
                    <div className='colour g-2' />
                    <div className='colour g-1' />
                    <div className='colour b-1' />
                </div>
                <div className='container colour-container flex no-gap flex-column'>
                    <p>Purple</p>
                    <div className='colour purple-base' />
                    <div className='colour purple-tint-1' />
                    <div className='colour purple-tint-2' />
                    <div className='colour purple-accent' />
                    <div className='colour purple-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p>Red</p>
                    <div className='colour red-base' />
                    <div className='colour red-tint-1' />
                    <div className='colour red-tint-2' />
                    <div className='colour red-accent' />
                    <div className='colour red-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p>Blue</p>
                    <div className='colour blue-base' />
                    <div className='colour blue-tint-1' />
                    <div className='colour blue-tint-2' />
                    <div className='colour blue-accent' />
                    <div className='colour blue-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p>Yellow</p>
                    <div className='colour yellow-base' />
                    <div className='colour yellow-tint-1' />
                    <div className='colour yellow-tint-2' />
                    <div className='colour yellow-accent' />
                    <div className='colour yellow-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p>Teal</p>
                    <div className='colour teal-base' />
                    <div className='colour teal-tint-1' />
                    <div className='colour teal-tint-2' />
                    <div className='colour teal-accent' />
                    <div className='colour teal-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p>Green</p>
                    <div className='colour green-base' />
                    <div className='colour green-tint-1' />
                    <div className='colour green-tint-2' />
                    <div className='colour green-accent' />
                    <div className='colour green-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p>Sand</p>
                    <div className='colour sand-base' />
                    <div className='colour sand-tint-1' />
                    <div className='colour sand-tint-2' />
                    <div className='colour sand-accent' />
                    <div className='colour sand-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p>Slate</p>
                    <div className='colour slate-base' />
                    <div className='colour slate-tint-1' />
                    <div className='colour slate-tint-2' />
                    <div className='colour slate-accent' />
                    <div className='colour slate-shade' />
                </div>
            </div>

            <h2>Buttons</h2>

            <table className='container table'>
                <thead>
                    <tr>
                        <th />
                        <th>Default</th>
                        <th>Primary</th>
                        <th>Success</th>
                        <th>Warning</th>
                        <th>Danger</th>
                    </tr>
                </thead>

                <tbody>
                    <tr>
                        <th>Default</th>
                        <td>
                            <Button icon={IconNames.ADD}>Your text here</Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.PRIMARY}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.SUCCESS}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.WARNING}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.DANGER}
                            >
                                Your text here
                            </Button>
                        </td>
                    </tr>
                    <tr>
                        <th>Outlined</th>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                variant={ButtonVariant.OUTLINED}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.PRIMARY}
                                variant={ButtonVariant.OUTLINED}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.SUCCESS}
                                variant={ButtonVariant.OUTLINED}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.WARNING}
                                variant={ButtonVariant.OUTLINED}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.DANGER}
                                variant={ButtonVariant.OUTLINED}
                            >
                                Your text here
                            </Button>
                        </td>
                    </tr>
                    <tr>
                        <th>Minimal</th>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                variant={ButtonVariant.MINIMAL}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.PRIMARY}
                                variant={ButtonVariant.MINIMAL}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.SUCCESS}
                                variant={ButtonVariant.MINIMAL}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.WARNING}
                                variant={ButtonVariant.MINIMAL}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ADD}
                                intent={Intent.DANGER}
                                variant={ButtonVariant.MINIMAL}
                            >
                                Your text here
                            </Button>
                        </td>
                    </tr>
                </tbody>
            </table>

            <div className='container'>
                <h3>Icons</h3>

                <ButtonGroup>
                    <Button
                        icon={IconNames.ArrowLeft}
                        variant={ButtonVariant.OUTLINED}
                    />

                    <Button
                        icon={IconNames.LIST}
                        variant={ButtonVariant.OUTLINED}
                    />

                    <Button
                        endIcon={IconNames.ArrowRight}
                        variant={ButtonVariant.OUTLINED}
                    />
                </ButtonGroup>

                <ButtonGroup variant={ButtonVariant.MINIMAL}>
                    <Tooltip
                        content='Expand all'
                        placement={PopoverPosition.TOP}
                    >
                        <Button endIcon={IconNames.ExpandAll} />
                    </Tooltip>

                    <Tooltip
                        content='Sort by id ascending'
                        placement={PopoverPosition.TOP}
                    >
                        <Button icon={IconNames.SortAlphabetical} />
                    </Tooltip>

                    <Tooltip
                        content='Sort by duration ascending'
                        placement={PopoverPosition.TOP}
                    >
                        <Button icon={IconNames.SortNumerical} />
                    </Tooltip>

                    <Tooltip
                        content='Scroll to top'
                        placement={PopoverPosition.TOP}
                    >
                        <Button icon={IconNames.DOUBLE_CHEVRON_UP} />
                    </Tooltip>

                    <Tooltip
                        content='Scroll to bottom'
                        placement={PopoverPosition.TOP}
                    >
                        <Button icon={IconNames.DOUBLE_CHEVRON_DOWN} />
                    </Tooltip>
                </ButtonGroup>
            </div>

            <h2>Form elements</h2>

            <FormGroup
                {...FORM_GROUP}
                className='short-width'
            >
                <InputGroup
                    className='bp6-light'
                    onChange={() => {}}
                    leftIcon={IconNames.FOLDER_NEW}
                />
            </FormGroup>

            <div className='container flex'>
                <InputGroup
                    className='bp6-light'
                    onChange={() => {}}
                    intent={Intent.PRIMARY}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
                    className='bp6-light'
                    onChange={() => {}}
                    intent={Intent.WARNING}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
                    className='bp6-light'
                    onChange={() => {}}
                    intent={Intent.SUCCESS}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
                    className='bp6-light'
                    onChange={() => {}}
                    intent={Intent.DANGER}
                    leftIcon={IconNames.FOLDER_NEW}
                />
            </div>

            <div className='short-width'>
                <FormGroup>
                    <SearchField
                        placeholder='Filter operations'
                        searchQuery=''
                        onQueryChanged={() => {}}
                    />
                </FormGroup>
            </div>

            <FormGroup>
                <label
                    className='bp6-file-input'
                    htmlFor='local-upload'
                >
                    <input
                        id='local-upload'
                        type='file'
                        multiple
                    />
                    <span className='bp6-file-upload-input'>Select files...</span>
                </label>
            </FormGroup>

            <FormGroup>
                <Switch label='Toggle switch' />
                <Switch
                    label='Toggle switch'
                    onChange={() => {}}
                    checked
                />

                <GlobalSwitch
                    label='Global switch'
                    onChange={() => {}}
                    checked={false}
                />
                <GlobalSwitch
                    label='Global switch'
                    onChange={() => {}}
                    checked
                />
            </FormGroup>

            <h2>Components</h2>

            <h3>Tags</h3>

            <div className='container flex'>
                <Tag
                    intent={Intent.NONE}
                    size={Size.LARGE}
                >
                    None
                </Tag>
                <Tag
                    intent={Intent.PRIMARY}
                    size={Size.LARGE}
                >
                    Primary
                </Tag>
                <Tag
                    intent={Intent.WARNING}
                    size={Size.LARGE}
                >
                    Warning
                </Tag>
                <Tag
                    intent={Intent.SUCCESS}
                    size={Size.LARGE}
                >
                    Success
                </Tag>
                <Tag
                    intent={Intent.DANGER}
                    size={Size.LARGE}
                >
                    Danger
                </Tag>

                <MemoryTag memory='L1' />

                <MemoryTag memory='DRAM' />
            </div>

            <h3>Progress bar</h3>

            <div className='container short-width'>
                <ProgressBar
                    progress={0.05}
                    estimated={36}
                />
            </div>

            <div className='container short-width'>
                <ProgressBar
                    progress={0.5}
                    estimated={17}
                />
            </div>

            <div className='container short-width'>
                <ProgressBar
                    progress={0.95}
                    estimated={1}
                />
            </div>

            <div className='container flex'>
                <FormGroup label='File Status Overlay auto close time (ms)'>
                    <InputGroup
                        type='number'
                        value={autoCloseTime.toString()}
                        onChange={(e) => setAutoCloseTime(Number(e.target.value))}
                    />

                    <Button
                        onClick={handleUpdateFileTransferProgress}
                        intent={Intent.PRIMARY}
                        disabled={updateFileTransferProgress.status !== FileStatus.INACTIVE}
                    >
                        Open file status overlay
                    </Button>
                </FormGroup>

                {updateFileTransferProgress.status !== FileStatus.INACTIVE && (
                    <p className='countdown'>{timeRemaining}ms</p>
                )}
                <FileStatusOverlay />
            </div>

            <div className='container flex flex-column'>
                <h3>Connection message</h3>

                <ConnectionTestMessage
                    status={ConnectionTestStates.IDLE}
                    message='Operation is idle'
                />
                <ConnectionTestMessage
                    status={ConnectionTestStates.PROGRESS}
                    message='Operation in progress'
                />
                <ConnectionTestMessage
                    status={ConnectionTestStates.OK}
                    message='Operation is successful'
                />
                <ConnectionTestMessage
                    status={ConnectionTestStates.FAILED}
                    message='Operation failed :('
                />
            </div>

            <div className='container'>
                <h3>Loading spinner</h3>

                <LoadingSpinner />
            </div>

            <div className='container'>
                <h3>NPE Processing Status</h3>

                <h4>Initial state (no uploaded file)</h4>
                <NPEProcessingStatus
                    dataVersion={null}
                    errorType={getNpeDataErrorType(null)}
                    isLoading={false}
                />

                <h4>Loading state</h4>
                <NPEProcessingStatus
                    dataVersion={null}
                    errorType={getNpeDataErrorType(null)}
                    isLoading
                />

                <h4>Legacy file format (no version)</h4>
                <NPEProcessingStatus
                    dataVersion={null}
                    errorType={getNpeDataErrorType(null)}
                    hasUploadedFile
                    isLoading={false}
                />

                <h4>Invalid NPE Data</h4>
                <NPEProcessingStatus
                    hasUploadedFile
                    dataVersion={MIN_NPE_DATA_VERSION}
                    errorType={getNpeDataErrorType(MIN_NPE_DATA_VERSION, undefined, true)}
                    isLoading={false}
                />

                <h4>Unprocessable JSON error (HTTP 422)</h4>
                <NPEProcessingStatus
                    hasUploadedFile
                    dataVersion={MIN_NPE_DATA_VERSION}
                    errorType={getNpeDataErrorType(MIN_NPE_DATA_VERSION, 422)}
                    isLoading={false}
                />

                <h4>Unknown error (HTTP 500)</h4>
                <NPEProcessingStatus
                    hasUploadedFile
                    dataVersion={MIN_NPE_DATA_VERSION}
                    errorType={getNpeDataErrorType(MIN_NPE_DATA_VERSION, 500)}
                    isLoading={false}
                />
            </div>
        </>
    );
}
