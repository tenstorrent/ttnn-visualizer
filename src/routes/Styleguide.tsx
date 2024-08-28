/* eslint-disable react/jsx-props-no-spreading */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import {
    Button,
    ButtonGroup,
    FormGroup,
    InputGroup,
    Intent,
    PopoverPosition,
    Switch,
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

const FORM_GROUP = {
    label: 'Form label',
    subLabel: 'Sub label here',
};

export default function Operations() {
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
                <p>
                    <strong>Paragraph</strong>
                </p>
                <p>
                    Lorem ipsum dolor sit amet <em>consectetur adipisicing</em> elit. Error laborum atque suscipit.
                    Officiis fugit necessitatibus libero <strong>perspiciatis sequi </strong>accusantium earum{' '}
                    <a href='#123'>repudiandae deserunt</a> nemo, <u>voluptatem tempora</u> laborum eaque minima
                    molestiae eveniet.
                </p>

                <p>
                    <strong>Monospace</strong>
                </p>
                <p className='monospace'>
                    Lorem ipsum dolor sit, amet consectetur adipisicing elit. Magni nemo velit molestias quae temporibus
                    sint in at consectetur voluptatem obcaecati, saepe, ratione, reprehenderit perferendis quas
                    explicabo error repellendus deserunt? Optio!
                </p>

                <p>
                    <strong>Horizontal ruler</strong>
                </p>
                <hr />
            </div>

            <h2>Colours</h2>

            <p>Greys</p>
            <div className='container flex'>
                <div className='container colour-container flex no-gap flex-column'>
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
                <div>
                    <p>Default</p>

                    <Button icon={IconNames.ADD}>Your text here</Button>
                    <Button
                        icon={IconNames.ADD}
                        minimal
                    >
                        Your text here
                    </Button>

                    <button
                        type='button'
                        className='btn-default bp5-button'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>

                    <button
                        type='button'
                        className='btn-default bp5-button bp5-minimal'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>
                </div>

                <div>
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
                        minimal
                    >
                        Your text here
                    </Button>

                    <button
                        type='button'
                        className='btn bp5-button bp5-intent-primary'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>

                    <button
                        type='button'
                        className='btn bp5-button bp5-minimal bp5-intent-primary'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>
                </div>

                <div>
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
                        minimal
                    >
                        Your text here
                    </Button>

                    <button
                        type='button'
                        className='btn-success bp5-button bp5-intent-success'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>

                    <button
                        type='button'
                        className='btn-success bp5-button bp5-minimal bp5-intent-success'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>
                </div>

                <div>
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
                        minimal
                    >
                        Your text here
                    </Button>

                    <button
                        type='button'
                        className='btn-warning bp5-button bp5-intent-warning'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>

                    <button
                        type='button'
                        className='btn-warning bp5-button bp5-minimal bp5-intent-warning'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>
                </div>

                <div>
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
                        minimal
                    >
                        Your text here
                    </Button>

                    <button
                        type='button'
                        className='btn-error bp5-button bp5-intent-danger'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>

                    <button
                        type='button'
                        className='btn-error bp5-button bp5-minimal bp5-intent-danger'
                    >
                        <span
                            aria-hidden='true'
                            className='bp5-icon bp5-icon-add'
                        >
                            <svg
                                data-icon='add'
                                height='16'
                                role='img'
                                viewBox='0 0 16 16'
                                width='16'
                            >
                                <path
                                    d='M10.99 6.99h-2v-2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-3-7c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.68 6-6 6z'
                                    fillRule='evenodd'
                                />
                            </svg>
                        </span>
                        <span className='bp5-button-text'>Your text here</span>
                    </button>
                </div>
            </div>

            <div className='container'>
                <p>Icons</p>
                <ButtonGroup>
                    <Button
                        icon={IconNames.ArrowLeft}
                        outlined
                    />

                    <Button
                        icon={IconNames.LIST}
                        outlined
                    />

                    <Button
                        rightIcon={IconNames.ArrowRight}
                        outlined
                    />
                </ButtonGroup>

                <ButtonGroup minimal>
                    <Tooltip
                        content='Expand all'
                        placement={PopoverPosition.TOP}
                    >
                        <Button rightIcon={IconNames.ExpandAll} />
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

            <h3>Form elements</h3>

            <FormGroup
                {...FORM_GROUP}
                className='short-width'
            >
                <InputGroup
                    className='bp5-light'
                    onChange={() => {}}
                    leftIcon={IconNames.FOLDER_NEW}
                />
            </FormGroup>

            <div className='container flex'>
                <InputGroup
                    className='bp5-light'
                    onChange={() => {}}
                    intent={Intent.PRIMARY}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
                    className='bp5-light'
                    onChange={() => {}}
                    intent={Intent.WARNING}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
                    className='bp5-light'
                    onChange={() => {}}
                    intent={Intent.SUCCESS}
                    leftIcon={IconNames.FOLDER_NEW}
                />

                <InputGroup
                    className='bp5-light'
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
                    className='bp5-file-input'
                    htmlFor='local-upload'
                >
                    <input
                        id='local-upload'
                        type='file'
                        multiple
                    />
                    <span className='bp5-file-upload-input'>Select files...</span>
                </label>
            </FormGroup>

            <FormGroup>
                <Switch label='Toggle switch' />
                <Switch
                    label='Toggle switch'
                    onChange={() => {}}
                    checked
                />
            </FormGroup>

            <h3>Components</h3>

            <p>Progress bar</p>

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

            <div className='container'>
                <p>Connection message</p>

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
                <p>Loading spinner</p>

                <LoadingSpinner />
            </div>
        </>
    );
}
