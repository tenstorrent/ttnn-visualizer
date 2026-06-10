// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    Button,
    ButtonGroup,
    ButtonVariant,
    Classes,
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
import AppVersionStatus from '../components/AppVersionStatus';
import 'styles/routes/Styleguide.scss';
import LoadingSpinner from '../components/LoadingSpinner';
import GlobalSwitch from '../components/GlobalSwitch';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import MemoryTag from '../components/MemoryTag';
import { fileTransferProgressAtom, getInactiveFileTransferProgress } from '../store/app';
import { FileProgress, FileStatus } from '../model/APIData';
import NPEProcessingStatus from '../components/NPEProcessingStatus';
import { PerfOverlayLegend, PerfOverlayOpMetric } from '../components/OperationGraphComponent';
import { perfColorScale } from '../functions/perfOverlay';
import { MIN_SUPPORTED_VERSION, NPEValidationError } from '../definitions/NPEData';
import MlirNodeDetailsPanel from '../components/mlir/MlirNodeDetailsPanel';
import type { IncomingEdgeView, OutgoingEdge, SourceNode } from '../components/mlir/mlirGraphTypes';

const FORM_GROUP = {
    label: 'Form label',
    subLabel: 'Sub label here',
};

const SYNC_DEMO_PROGRESS = {
    currentFileName: 'example_test_file_1.txt',
    numberOfFiles: 3,
    percentOfCurrent: 0,
    finishedFiles: 1,
    status: FileStatus.DOWNLOADING,
    bytesTransferred: 128_000,
    bytesTotal: 512_000,
    currentFileSize: 128_000,
};

// STARTED phase of a remote sync: backend has emitted job totals but no
// per-file event yet, so `currentFileName` is empty and the overlay renders
// the standalone `Preparing\u2026` label (issue #1599).
const SYNC_STARTING_DEMO_PROGRESS = {
    currentFileName: '',
    numberOfFiles: 3,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.STARTED,
    bytesTransferred: 0,
    bytesTotal: 512_000,
    currentFileSize: 0,
};

const UPLOAD_DEMO_PROGRESS = {
    currentFileName: '',
    numberOfFiles: 5,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.UPLOADING,
    bytesTransferred: 64_000,
    bytesTotal: 1_024_000,
};

const TIME_REMAINING_INTERVAL = 100;

const LATEST_APP_VERSION = '0.80.0';

const MLIR_RICH_NODE: SourceNode = {
    id: 'loc("-":4:12)__1',
    label: 'stablehlo.dot_general',
    namespace: 'func.func_main/stablehlo.dot_general_0',
    attrs: [
        { key: 'name', value: 'f0_dot' },
        { key: 'precision_config', value: '["DEFAULT","DEFAULT"]' },
        {
            key: 'dot_dimension_numbers',
            value: '{"lhs_contracting_dims":[1],"rhs_contracting_dims":[0],"lhs_batching_dims":[],"rhs_batching_dims":[]}',
        },
        { key: 'is_stable', value: 'true' },
        { key: 'cost', value: '128' },
    ],
    incomingEdges: [
        { sourceNodeId: '%arg42', sourceNodeOutputId: '0', targetNodeInputId: '0' },
        { sourceNodeId: '%arg7', sourceNodeOutputId: '0', targetNodeInputId: '1' },
        { sourceNodeId: 'loc("-":3:8)__0', sourceNodeOutputId: '2', targetNodeInputId: '2' },
    ],
    // Port 0 has shape + dtype (renders as a compact `[4, 8] f32` pill) plus
    // `schedule` (renders as an extra below the pill). `rank` and
    // `__tensor_tag` are also present but are filtered out by the panel —
    // they're included here so the example reflects what real adapter
    // output looks like.
    // Port 1 carries no metadata at all and shows the "no metadata" hint
    // unless it has consumers.
    outputsMetadata: [
        {
            id: '0',
            attrs: [
                { key: 'shape', value: '[4, 8]' },
                { key: 'dtype', value: 'f32' },
                { key: '__tensor_tag', value: '%result_42' },
                { key: 'rank', value: '2' },
                { key: 'schedule', value: '12' },
            ],
        },
        { id: '1', attrs: [] },
    ],
    config: null,
};

// Incoming-edge view fixtures for the rich-node example:
//   - First edge has rich port metadata → compact pill + `broadcast_dimensions` extra.
//   - Second edge has port metadata with only shape/dtype → compact pill, no extras.
//   - Third edge has no port metadata → falls back to the bare `edge.label` shape line.
const MLIR_RICH_NODE_INCOMING: IncomingEdgeView[] = [
    {
        sourceNodeId: 'loc("-":3:8)__0',
        sourceNodeLabel: 'stablehlo.broadcast_in_dim',
        sourceNodeOutputId: '0',
        targetNodeInputId: '0',
        label: '[4, 8] f32',
        sourcePortMetadata: {
            id: '0',
            attrs: [
                { key: 'shape', value: '[4, 8]' },
                { key: 'dtype', value: 'f32' },
                { key: 'broadcast_dimensions', value: '[0]' },
            ],
        },
    },
    {
        sourceNodeId: 'loc("-":2:8)__0',
        sourceNodeLabel: 'stablehlo.constant',
        sourceNodeOutputId: '0',
        targetNodeInputId: '1',
        label: '[8] f32',
        sourcePortMetadata: {
            id: '0',
            attrs: [
                { key: 'shape', value: '[8]' },
                { key: 'dtype', value: 'f32' },
            ],
        },
    },
    {
        sourceNodeId: '%arg42',
        sourceNodeLabel: '%arg42',
        sourceNodeOutputId: '0',
        targetNodeInputId: '2',
        label: '[4] f32',
        sourcePortMetadata: null,
    },
];

// Outgoing-edge fixtures: port 0 fans out to two consumers. We give the
// fan-out a heterogeneous shape so the example shows that the edge label
// belongs to the *edge*, not the port.
const MLIR_RICH_NODE_OUTGOING: OutgoingEdge[] = [
    {
        targetNodeId: 'loc("-":7:4)__2',
        targetNodeLabel: 'stablehlo.add',
        sourceNodeOutputId: '0',
        targetNodeInputId: '0',
        label: '[4, 8] f32',
    },
    {
        targetNodeId: 'loc("-":9:4)__3',
        targetNodeLabel: 'stablehlo.reshape',
        sourceNodeOutputId: '0',
        targetNodeInputId: '1',
        label: '[4, 8] f32',
    },
];

const MLIR_EMPTY_NODE: SourceNode = {
    id: 'input_0',
    label: '%arg0',
    namespace: '',
    attrs: [],
    incomingEdges: [],
    outputsMetadata: [],
    config: null,
};

// Terminator-style op: empty outputsMetadata but synthesised outgoing edges
// (e.g. `stablehlo.return` plumbing its region value to a downstream op).
const MLIR_TERMINATOR_NODE: SourceNode = {
    id: 'loc("-":24:8)__1',
    label: 'stablehlo.return',
    namespace: 'func.func_main/stablehlo.all_reduce_0',
    attrs: [
        { key: 'full_location', value: 'loc("-":24:8)' },
        { key: 'schedule', value: '20' },
    ],
    incomingEdges: [{ sourceNodeId: 'loc("-":23:16)__1', sourceNodeOutputId: '0', targetNodeInputId: '0' }],
    outputsMetadata: [],
    config: null,
};

const MLIR_TERMINATOR_OUTGOING: OutgoingEdge[] = [
    {
        targetNodeId: 'stablehlo.reshape_0',
        targetNodeLabel: 'stablehlo.reshape',
        sourceNodeOutputId: '0',
        targetNodeInputId: '0',
        label: '[7, 3072] bf16',
    },
];

export default function Styleguide() {
    const [updateFileTransferProgress, setUpdateFileTransferProgress] = useAtom(fileTransferProgressAtom);
    const [autoCloseTime, setAutoCloseTime] = useState(1000);
    const [timeRemaining, setTimeRemaining] = useState(autoCloseTime);

    const runFileTransferDemo = (initial: FileProgress) => {
        setUpdateFileTransferProgress(initial);
        setTimeRemaining(autoCloseTime);

        const calculateRemainingTime = setInterval(() => {
            setTimeRemaining((prev) => prev - TIME_REMAINING_INTERVAL);
            setUpdateFileTransferProgress((status) => ({
                ...status,
                percentOfCurrent: status.percentOfCurrent + (TIME_REMAINING_INTERVAL / autoCloseTime) * 75,
            }));
        }, TIME_REMAINING_INTERVAL);

        setTimeout(() => {
            setUpdateFileTransferProgress(getInactiveFileTransferProgress());
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
                    <p className='heading'>Grey</p>
                    <div className='colour w-1' />
                    <div className='colour g-6' />
                    <div className='colour g-5' />
                    <div className='colour g-4' />
                    <div className='colour g-3' />
                    <div className='colour g-2' />
                    <div className='colour g-1' />
                    <div className='colour b-1' />
                </div>
            </div>

            <div className='container flex wrap'>
                <div className='container colour-container flex no-gap flex-column'>
                    <p className='heading'>Purple</p>
                    <div className='colour purple-base' />
                    <div className='colour purple-tint-1' />
                    <div className='colour purple-tint-2' />
                    <div className='colour purple-accent' />
                    <div className='colour purple-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p className='heading'>Red</p>
                    <div className='colour red-base' />
                    <div className='colour red-tint-1' />
                    <div className='colour red-tint-2' />
                    <div className='colour red-accent' />
                    <div className='colour red-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p className='heading'>Blue</p>
                    <div className='colour blue-base' />
                    <div className='colour blue-tint-1' />
                    <div className='colour blue-tint-2' />
                    <div className='colour blue-accent' />
                    <div className='colour blue-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p className='heading'>Yellow</p>
                    <div className='colour yellow-base' />
                    <div className='colour yellow-tint-1' />
                    <div className='colour yellow-tint-2' />
                    <div className='colour yellow-accent' />
                    <div className='colour yellow-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p className='heading'>Teal</p>
                    <div className='colour teal-base' />
                    <div className='colour teal-tint-1' />
                    <div className='colour teal-tint-2' />
                    <div className='colour teal-accent' />
                    <div className='colour teal-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p className='heading'>Green</p>
                    <div className='colour green-base' />
                    <div className='colour green-tint-1' />
                    <div className='colour green-tint-2' />
                    <div className='colour green-accent' />
                    <div className='colour green-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p className='heading'>Sand</p>
                    <div className='colour sand-base' />
                    <div className='colour sand-tint-1' />
                    <div className='colour sand-tint-2' />
                    <div className='colour sand-accent' />
                    <div className='colour sand-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <p className='heading'>Slate</p>
                    <div className='colour slate-base' />
                    <div className='colour slate-tint-1' />
                    <div className='colour slate-tint-2' />
                    <div className='colour slate-accent' />
                    <div className='colour slate-shade' />
                </div>

                <div className='container colour-container flex no-gap flex-column'>
                    <div className='colour heading'>&nbsp;</div>
                    <div className='colour heading'>Base</div>
                    <div className='colour heading'>Tint 1</div>
                    <div className='colour heading'>Tint 2</div>
                    <div className='colour heading'>Accent</div>
                    <div className='colour heading'>Shade</div>
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
                            <Button>Your text here</Button>
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
                                icon={IconNames.TICK}
                                intent={Intent.SUCCESS}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.WARNING_SIGN}
                                intent={Intent.WARNING}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ISSUE}
                                intent={Intent.DANGER}
                            >
                                Your text here
                            </Button>
                        </td>
                    </tr>
                    <tr>
                        <th>Outlined</th>
                        <td>
                            <Button variant={ButtonVariant.OUTLINED}>Your text here</Button>
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
                                icon={IconNames.TICK}
                                intent={Intent.SUCCESS}
                                variant={ButtonVariant.OUTLINED}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.WARNING_SIGN}
                                intent={Intent.WARNING}
                                variant={ButtonVariant.OUTLINED}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ISSUE}
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
                            <Button variant={ButtonVariant.MINIMAL}>Your text here</Button>
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
                                icon={IconNames.TICK}
                                intent={Intent.SUCCESS}
                                variant={ButtonVariant.MINIMAL}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.WARNING_SIGN}
                                intent={Intent.WARNING}
                                variant={ButtonVariant.MINIMAL}
                            >
                                Your text here
                            </Button>
                        </td>
                        <td>
                            <Button
                                icon={IconNames.ISSUE}
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

                    <Tooltip
                        content='Toggle high consumer tensors'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => {}}
                            endIcon={IconNames.ISSUE}
                            intent={Intent.DANGER}
                            aria-label='Toggle high consumer tensors'
                        >
                            27
                        </Button>
                    </Tooltip>

                    <Tooltip
                        content='Show late deallocated tensors'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => {}}
                            endIcon={IconNames.OUTDATED}
                            intent={Intent.WARNING}
                            variant={ButtonVariant.OUTLINED}
                            aria-label='Toggle late deallocated tensors'
                        >
                            123
                        </Button>
                    </Tooltip>
                </ButtonGroup>
            </div>

            <h2>Form elements</h2>

            <FormGroup
                {...FORM_GROUP}
                className='short-width'
            >
                <InputGroup
                    onChange={() => {}}
                    leftIcon={IconNames.FOLDER_NEW}
                />
            </FormGroup>

            <div className='container flex'>
                <InputGroup
                    onChange={() => {}}
                    intent={Intent.PRIMARY}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
                    onChange={() => {}}
                    intent={Intent.WARNING}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
                    onChange={() => {}}
                    intent={Intent.SUCCESS}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
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
                    className={Classes.FILE_INPUT}
                    htmlFor='local-upload'
                >
                    <input
                        id='local-upload'
                        type='file'
                        multiple
                    />
                    <span className={Classes.FILE_UPLOAD_INPUT}>Select files...</span>
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
                <ProgressBar progress={0} />
            </div>

            <div className='container short-width'>
                <ProgressBar progress={0.85} />
            </div>

            <div className='container flex'>
                <FormGroup label='File Status Overlay auto close time (ms)'>
                    <InputGroup
                        type='number'
                        value={autoCloseTime.toString()}
                        onChange={(e) => setAutoCloseTime(Number(e.target.value))}
                    />

                    <ButtonGroup>
                        <Button
                            onClick={() => runFileTransferDemo(SYNC_STARTING_DEMO_PROGRESS)}
                            intent={Intent.PRIMARY}
                            disabled={updateFileTransferProgress.status !== FileStatus.INACTIVE}
                        >
                            Open remote sync overlay (preparing)
                        </Button>
                        <Button
                            onClick={() => runFileTransferDemo(SYNC_DEMO_PROGRESS)}
                            intent={Intent.PRIMARY}
                            disabled={updateFileTransferProgress.status !== FileStatus.INACTIVE}
                        >
                            Open remote sync overlay
                        </Button>
                        <Button
                            onClick={() => runFileTransferDemo(UPLOAD_DEMO_PROGRESS)}
                            intent={Intent.PRIMARY}
                            disabled={updateFileTransferProgress.status !== FileStatus.INACTIVE}
                        >
                            Open local upload overlay
                        </Button>
                    </ButtonGroup>
                </FormGroup>

                {updateFileTransferProgress.status !== FileStatus.INACTIVE && (
                    <p className='countdown'>{timeRemaining}ms</p>
                )}
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
                    errorCode={NPEValidationError.OK}
                    isLoading={false}
                />

                <h4>Loading state</h4>
                <NPEProcessingStatus
                    dataVersion={null}
                    errorCode={NPEValidationError.OK}
                    isLoading
                />

                <h4>Legacy file format (no version)</h4>
                <NPEProcessingStatus
                    dataVersion={null}
                    errorCode={NPEValidationError.INVALID_NPE_VERSION}
                    hasUploadedFile
                    isLoading={false}
                />

                <h4>Invalid NPE Data</h4>
                <NPEProcessingStatus
                    hasUploadedFile
                    dataVersion={MIN_SUPPORTED_VERSION}
                    errorCode={NPEValidationError.INVALID_NPE_DATA}
                    isLoading={false}
                />

                <h4>Empty NPE trace (no transfers or timesteps)</h4>
                <NPEProcessingStatus
                    hasUploadedFile
                    dataVersion={MIN_SUPPORTED_VERSION}
                    errorCode={NPEValidationError.EMPTY_NPE_TRACE}
                    isLoading={false}
                />

                <h4>Unprocessable JSON error (HTTP 422)</h4>
                <NPEProcessingStatus
                    hasUploadedFile
                    dataVersion={MIN_SUPPORTED_VERSION}
                    errorCode={NPEValidationError.INVALID_JSON}
                    isLoading={false}
                />

                <h4>Internal server error (HTTP 500)</h4>
                <NPEProcessingStatus
                    hasUploadedFile
                    dataVersion={MIN_SUPPORTED_VERSION}
                    errorCode={NPEValidationError.DEFAULT}
                    isLoading={false}
                />
            </div>

            <div className='container'>
                <h3>App version status</h3>

                <h4>Up to date</h4>
                <AppVersionStatus
                    appVersion='0.80.0'
                    latestAppVersion={LATEST_APP_VERSION}
                />

                <h4>Level one outdated</h4>
                <AppVersionStatus
                    appVersion='0.79.0'
                    latestAppVersion={LATEST_APP_VERSION}
                />

                <h4>Level two outdated</h4>
                <AppVersionStatus
                    appVersion='0.78.0'
                    latestAppVersion={LATEST_APP_VERSION}
                />

                <h4>Level three outdated</h4>
                <AppVersionStatus
                    appVersion='0.77.0'
                    latestAppVersion={LATEST_APP_VERSION}
                />
            </div>

            <div className='container operation-graph-component'>
                <h3>Operation graph perf overlay</h3>

                <h4>Legend &mdash; typical range (µs &ndash; ms)</h4>
                <div className='styleguide-perf-overlay-host'>
                    <PerfOverlayLegend
                        minNs={1_200}
                        maxNs={48_000_000}
                    />
                </div>

                <h4>Legend &mdash; single bin (all equal)</h4>
                <div className='styleguide-perf-overlay-host'>
                    <PerfOverlayLegend
                        minNs={50_000}
                        maxNs={50_000}
                    />
                </div>

                <h4>Op metric &mdash; cool (low t)</h4>
                <PerfOverlayOpMetric
                    perfDeviceTimeNs={1_200}
                    perfColor={perfColorScale(0.15)}
                />

                <h4>Op metric &mdash; warm (mid t)</h4>
                <PerfOverlayOpMetric
                    perfDeviceTimeNs={12_500_000}
                    perfColor={perfColorScale(0.6)}
                />

                <h4>Op metric &mdash; hot (high t)</h4>
                <PerfOverlayOpMetric
                    perfDeviceTimeNs={48_000_000}
                    perfColor={perfColorScale(0.95)}
                />

                <h4>Op metric &mdash; no perf data for selected op</h4>
                <PerfOverlayOpMetric />
            </div>

            <div className='container'>
                <h3>MLIR Node Details Panel</h3>

                <h4>Selected op with rich attrs, port metadata, and fan-out outputs</h4>
                <p>
                    Inputs demonstrate the three port-metadata states: rich (compact pill + extras), shape/dtype only
                    (compact pill alone), and no metadata (fall back to the edge&apos;s shape label). Outputs show the
                    compact pill with a `schedule` extra plus a sibling port that has no metadata. `rank` and
                    `__tensor_tag` are present in the source data but filtered out of the rendered view.
                </p>
                <div className='styleguide-bounded-host'>
                    <MlirNodeDetailsPanel
                        node={MLIR_RICH_NODE}
                        incomingEdges={MLIR_RICH_NODE_INCOMING}
                        outgoingEdges={MLIR_RICH_NODE_OUTGOING}
                        outputsMetadata={MLIR_RICH_NODE.outputsMetadata}
                        onClose={() => {}}
                        onRecenter={() => {}}
                        onNavigateToNode={() => {}}
                    />
                </div>

                <h4>Terminator op (empty outputs metadata, but has outgoing edges)</h4>
                <div className='styleguide-bounded-host'>
                    <MlirNodeDetailsPanel
                        node={MLIR_TERMINATOR_NODE}
                        incomingEdges={[]}
                        outgoingEdges={MLIR_TERMINATOR_OUTGOING}
                        outputsMetadata={MLIR_TERMINATOR_NODE.outputsMetadata}
                        onClose={() => {}}
                        onRecenter={() => {}}
                        onNavigateToNode={() => {}}
                    />
                </div>

                <h4>Selected node with no attributes and no I/O (empty states)</h4>
                <div className='styleguide-bounded-host'>
                    <MlirNodeDetailsPanel
                        node={MLIR_EMPTY_NODE}
                        incomingEdges={[]}
                        outgoingEdges={[]}
                        outputsMetadata={[]}
                        onClose={() => {}}
                        onRecenter={() => {}}
                        onNavigateToNode={() => {}}
                    />
                </div>
            </div>
        </>
    );
}
