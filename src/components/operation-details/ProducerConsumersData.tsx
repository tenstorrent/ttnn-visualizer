// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Icon } from '@blueprintjs/core';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { IconNames } from '@blueprintjs/icons';
import { useRef } from 'react';
import ROUTES from '../../definitions/routes';
import { OperationDetails } from '../../model/OperationDetails';
import 'styles/components/ProducerConsumersData.scss';

interface ProducerConsumersDataProps {
    selectedTensor: number;
    details: OperationDetails;
    operationId: number;
}

function ProducerConsumersData({ selectedTensor, details, operationId }: ProducerConsumersDataProps) {
    const outsideRefs = useRef<HTMLElement[]>([]);

    const { producers, consumers } = details.getTensorProducerConsumer(selectedTensor);

    function assignRef(el: HTMLElement | null, index: number) {
        if (el) {
            outsideRefs.current[index] = el;
        }
    }

    return (
        <div className='plot-tensor-details'>
            <div
                ref={(el) => assignRef(el, 5)}
                className={classNames('producer-consumer', {
                    hidden: selectedTensor === null,
                })}
            >
                <div
                    className={classNames('title', {
                        hidden: producers.length === 0,
                    })}
                >
                    <Icon
                        size={14}
                        icon={IconNames.EXPORT}
                    />
                    Producers
                </div>

                {producers.length > 0 && (
                    <ul className={classNames('list')}>
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

                <div
                    className={classNames('title', {
                        hidden: consumers.length === 0,
                    })}
                >
                    <Icon
                        size={14}
                        icon={IconNames.IMPORT}
                        className='consumer-icon'
                    />{' '}
                    Consumers
                </div>

                {consumers.length > 0 && (
                    <ul className={classNames('list')}>
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
    );
}

export default ProducerConsumersData;
