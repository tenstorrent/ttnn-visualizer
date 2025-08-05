/* eslint-disable react/jsx-props-no-spreading */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    Button,
    ButtonGroup,
    FormGroup,
    InputGroup,
    Intent,
    PopoverPosition,
    Switch,
    Tag,
    Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Helmet } from 'react-helmet-async';
import ConnectionTestMessage from '../components/report-selection/ConnectionTestMessage';
import { ConnectionTestStates } from '../definitions/ConnectionStatus';
import ProgressBar from '../components/ProgressBar';
import SearchField from '../components/SearchField';
import 'styles/routes/Styleguide.scss';
import LoadingSpinner from '../components/LoadingSpinner';
import GlobalSwitch from '../components/GlobalSwitch';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import MemoryTag from '../components/MemoryTag';

const FORM_GROUP = {
    label: 'Form label',
    subLabel: 'Sub label here',
};

// const FILE_DOWNLOAD_STATUS = {
//     currentFileName: 'foo.tar.gz',
//     numberOfFiles: 12,
//     percentOfCurrent: 49,
//     finishedFiles: 6,
// };

export default function Styleguide() {
    // const [showProgressOverlay, setShowProgressOverlay] = useState(false);

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

            <div className='container flex'>
                <div className='flex flex-column'>
                    <p>Default</p>

                    <Button icon={IconNames.ADD}>Your text here</Button>
                    <Button
                        icon={IconNames.ADD}
                        variant='outlined'
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        variant='minimal'
                    >
                        Your text here
                    </Button>
                </div>

                <div className='flex flex-column'>
                    <p>Primary</p>

                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.PRIMARY}
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.PRIMARY}
                        variant='outlined'
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.PRIMARY}
                        variant='minimal'
                    >
                        Your text here
                    </Button>
                </div>

                <div className='flex flex-column'>
                    <p>Success</p>

                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.SUCCESS}
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.SUCCESS}
                        variant='outlined'
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.SUCCESS}
                        variant='minimal'
                    >
                        Your text here
                    </Button>
                </div>

                <div className='flex flex-column'>
                    <p>Warning</p>

                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.WARNING}
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.WARNING}
                        variant='outlined'
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.WARNING}
                        variant='minimal'
                    >
                        Your text here
                    </Button>
                </div>

                <div className='flex flex-column'>
                    <p>Danger</p>

                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.DANGER}
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.DANGER}
                        variant='outlined'
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.DANGER}
                        variant='minimal'
                    >
                        Your text here
                    </Button>
                </div>
            </div>

            <div className='container'>
                <h3>Icons</h3>

                <ButtonGroup>
                    <Button
                        icon={IconNames.ArrowLeft}
                        variant='outlined'
                    />

                    <Button
                        icon={IconNames.LIST}
                        variant='outlined'
                    />

                    <Button
                        endIcon={IconNames.ArrowRight}
                        variant='outlined'
                    />
                </ButtonGroup>

                <ButtonGroup variant='minimal'>
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
                    size='large'
                >
                    None
                </Tag>
                <Tag
                    intent={Intent.PRIMARY}
                    size='large'
                >
                    Primary
                </Tag>
                <Tag
                    intent={Intent.WARNING}
                    size='large'
                >
                    Warning
                </Tag>
                <Tag
                    intent={Intent.SUCCESS}
                    size='large'
                >
                    Success
                </Tag>
                <Tag
                    intent={Intent.DANGER}
                    size='large'
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

            {/* TODO: Get these working again */}
            {/* <div className='container'>
                <Button
                    onClick={() => setShowProgressOverlay(true)}
                    intent={Intent.PRIMARY}
                >
                    File status overlay
                </Button>

                <FileStatusOverlay
                    open={showProgressOverlay}
                    progress={FILE_DOWNLOAD_STATUS}
                    canEscapeKeyClose
                />
            </div> */}

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
        </>
    );
}
