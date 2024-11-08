// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { useState } from 'react';
import { Button, Icon } from '@blueprintjs/core';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { IconNames } from '@blueprintjs/icons';
import ROUTES from '../../definitions/routes';
import { OperationDetails } from '../../model/OperationDetails';
import 'styles/components/ProducerConsumersData.scss';
import { PRODUCER_CONSUMER_LIMIT } from '../../definitions/ProducersConsumers';
import { getTensorColor } from '../../functions/colorGenerator';
import { TensorData } from '../../model/APIData';

const ITEM_HEIGHT = 16; // Height in px

interface ProducerConsumersDataProps {
    selectedTensor: TensorData;
    details: OperationDetails;
    operationId: number;
}

function ProducerConsumersData({ selectedTensor, details, operationId }: ProducerConsumersDataProps) {
    const { id: tensorId, address } = selectedTensor;
    const { producers, consumers } = details.getTensorProducerConsumer(tensorId);
    const [isCollapsed, setIsCollapsed] = useState(selectedTensor === null);

    return (
        <aside className='plot-tensor-details'>
            <div className={classNames('producer-consumer-container', { 'is-collapsed': isCollapsed })}>
                <div className='header'>
                    <div
                        className={classNames('memory-color-block', { 'empty-tensor': address === null })}
                        style={{
                            backgroundColor: tensorId ? getTensorColor(tensorId) : '',
                        }}
                    />
                    <h3 className='tensor-id'>Tensor {tensorId}</h3>
                </div>

                <div
                    className={classNames('producer-consumer', {
                        hidden: selectedTensor === null || producers.length === 0,
                    })}
                >
                    <div className='title'>
                        <Icon
                            size={14}
                            icon={IconNames.EXPORT}
                        />
                        Producers ({producers.length})
                    </div>

                    {producers.length > 0 && (
                        <ul
                            className={classNames('list')}
                            style={{
                                maxHeight:
                                    producers.length > PRODUCER_CONSUMER_LIMIT
                                        ? `${PRODUCER_CONSUMER_LIMIT * ITEM_HEIGHT}px`
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
                        hidden: selectedTensor === null || consumers.length === 0,
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
                                    consumers.length > PRODUCER_CONSUMER_LIMIT
                                        ? `${PRODUCER_CONSUMER_LIMIT * ITEM_HEIGHT * 1.2}px`
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
            <Button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className='close-button'
                outlined
                text={isCollapsed ? 'Producers/Consumers' : ''}
                rightIcon={isCollapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
            />
        </aside>
    );
}

export default ProducerConsumersData;
