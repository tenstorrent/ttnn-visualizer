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

const ITEM_HEIGHT = 16; // Height in px

interface ProducerConsumersDataProps {
    selectedTensor: number | null;
    details: OperationDetails;
    operationId: number;
}

function ProducerConsumersData({ selectedTensor, details, operationId }: ProducerConsumersDataProps) {
    const { producers, consumers } = details.getTensorProducerConsumer(selectedTensor);
    const [isCollapsed, setIsCollapsed] = useState(selectedTensor === null);

    return (
        <div className='plot-tensor-details'>
            <div className={classNames('producer-consumer-container bg3', { 'is-collapsed': isCollapsed })}>
                <div
                    // ref={(el) => assignRef(el, 5)}
                    className={classNames('producer-consumer', {
                        hidden: selectedTensor === null,
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
                    // ref={(el) => assignRef(el, 5)}
                    className={classNames('producer-consumer', {
                        hidden: selectedTensor === null,
                    })}
                >
                    <div className='title'>
                        <Icon
                            size={14}
                            icon={IconNames.IMPORT}
                        />{' '}
                        Consumers
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
                rightIcon={isCollapsed ? IconNames.DRAWER_RIGHT_FILLED : IconNames.DRAWER_LEFT_FILLED}
            />
        </div>
    );
}

export default ProducerConsumersData;
