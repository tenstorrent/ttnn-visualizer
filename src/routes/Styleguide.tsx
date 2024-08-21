// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, ButtonGroup, FormGroup, Intent, PopoverPosition, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Helmet } from 'react-helmet-async';
import ConnectionTestMessage from '../components/report-selection/ConnectionTestMessage';
import { ConnectionTestStates } from '../definitions/ConnectionStatus';
import ProgressBar from '../components/ProgressBar';
import SearchField from '../components/SearchField';

export default function Operations() {
    return (
        <>
            <Helmet title='Styleguide' />

            <h2>Typography</h2>

            <p>
                <strong>Font family</strong>
            </p>

            <p>Arial Nova, Arial, sans-serif</p>

            <h1>Heading H1</h1>
            <h2>Heading H2</h2>
            <h3>Heading H3</h3>
            <h4>Heading H4</h4>
            <h5>Heading H5</h5>

            <p>
                <strong>Paragraph</strong>
            </p>
            <p>
                Lorem ipsum dolor sit amet <em>consectetur adipisicing</em> elit. Error laborum atque suscipit. Officiis
                fugit necessitatibus libero <strong>perspiciatis sequi </strong>accusantium earum repudiandae deserunt
                nemo, <u>voluptatem tempora</u> laborum eaque minima molestiae eveniet.
            </p>

            <p>
                <strong>Monospace</strong>
            </p>
            <p className='monospace'>
                Lorem ipsum dolor sit, amet consectetur adipisicing elit. Magni nemo velit molestias quae temporibus
                sint in at consectetur voluptatem obcaecati, saepe, ratione, reprehenderit perferendis quas explicabo
                error repellendus deserunt? Optio!
            </p>

            <h2>Buttons</h2>

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

            <div style={{ display: 'flex', gap: '10px' }}>
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

            <h3>Form elements</h3>

            <FormGroup>
                <SearchField
                    placeholder='Filter operations'
                    searchQuery=''
                    onQueryChanged={() => {}}
                />
            </FormGroup>

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

                <Switch label='Toggle switch' />
            </FormGroup>

            <h3>Status</h3>

            <p>Progress bar</p>

            <div style={{ width: '200px', marginBottom: '20px' }}>
                <ProgressBar
                    progress={0.37}
                    estimated={36}
                />
            </div>

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
        </>
    );
}
