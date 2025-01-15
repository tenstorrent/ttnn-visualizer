// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState } from 'react';
import { Button, Icon } from '@blueprintjs/core';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { IconNames } from '@blueprintjs/icons';
import ROUTES from '../../definitions/routes';
import { OperationDetails } from '../../model/OperationDetails';
import 'styles/components/ProducerConsumersData.scss';
import { MAX_NUM_CONSUMERS } from '../../definitions/ProducersConsumers';
import { getTensorColor } from '../../functions/colorGenerator';
import { Tensor } from '../../model/APIData';

const ITEM_HEIGHT = 16; // Height in px

interface ProducerConsumersDataProps {
    selectedTensor: Tensor | null;
    details: OperationDetails;
    operationId: number;
}

function ProducerConsumersData({ selectedTensor, details, operationId }: ProducerConsumersDataProps) {
    const [isCollapsed, setIsCollapsed] = useState(selectedTensor === null);

    if (!selectedTensor) {
        return null;
    }

    const { id: tensorId, address } = selectedTensor;
    const { producers, consumers } = details.getTensorProducerConsumer(tensorId);

    return (
        <aside className='plot-tensor-details'>
            <div className='producer-consumer-container'>
                <div className='header'>
                    <div className='tensor-title'>
                        <div
                            className={classNames('memory-color-block', { 'empty-tensor': address === null })}
                            style={{
                                backgroundColor: tensorId ? getTensorColor(tensorId) : '',
                            }}
                        />

                        <h3 className='tensor-id'>Tensor {tensorId}</h3>
                    </div>

                    <Button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className='close-button'
                        rightIcon={isCollapsed ? IconNames.CARET_DOWN : IconNames.CARET_UP}
                        minimal
                        small
                    />
                </div>

                <div
                    className={classNames('producer-consumer', {
                        hidden: selectedTensor === null || producers.length === 0 || isCollapsed,
                    })}
                >
                    <div className='title'>
                        <Icon
                            size={14}
                            icon={IconNames.EXPORT}
                        />
                        Producers
                    </div>

                    {producers.length > 0 && (
                        <ul
                            className={classNames('list')}
                            style={{
                                maxHeight:
                                    producers.length > MAX_NUM_CONSUMERS
                                        ? `${MAX_NUM_CONSUMERS * ITEM_HEIGHT}px`
                                        : 'none',
                            }}
                        >
                            {producers.map((op) => (
                                <li
                                    key={op.id}
                                    className='operation-link'
                                >
                                    {operationId === op.id ? (
                                        <span className='selected-tensor'>
                                            {op.id} {op.name}
                                        </span>
                                    ) : (
                                        <Link
                                            to={`${ROUTES.OPERATIONS}/${op.id}`}
                                            className={classNames('', { current: operationId === op.id })}
                                        >
                                            {op.id} {op.name}
                                        </Link>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div
                    className={classNames('producer-consumer', {
                        hidden: selectedTensor === null || consumers.length === 0 || isCollapsed,
                    })}
                >
                    <div className='title'>
                        <Icon
                            size={14}
                            icon={IconNames.IMPORT}
                        />{' '}
                        Consumers ({consumers.length})
                    </div>

                    {consumers.length > 0 && (
                        <ul
                            className={classNames('list')}
                            style={{
                                maxHeight:
                                    consumers.length > MAX_NUM_CONSUMERS
                                        ? `${MAX_NUM_CONSUMERS * ITEM_HEIGHT * 1.2}px`
                                        : 'none',
                            }}
                        >
                            {consumers.map((op) => (
                                <li
                                    key={op.id}
                                    className='operation-link'
                                >
                                    {operationId === op.id ? (
                                        <span className='selected-tensor'>
                                            {op.id} {op.name}
                                        </span>
                                    ) : (
                                        <Link
                                            to={`${ROUTES.OPERATIONS}/${op.id}`}
                                            className={classNames('', { current: operationId === op.id })}
                                        >
                                            {op.id} {op.name}
                                        </Link>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </aside>
    );
}

export default ProducerConsumersData;
