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
import 'styles/components/ProducerConsumers.scss';

interface ProducerConsumersProps {
    selectedTensor: number;
    details: OperationDetails;
    operationId: number;
}

function ProducerConsumers({ selectedTensor, details, operationId }: ProducerConsumersProps) {
    const outsideRefs = useRef<HTMLElement[]>([]);

    function assignRef(el: HTMLElement | null, index: number) {
        if (el) {
            outsideRefs.current[index] = el;
        }
    }

    return (
        <div className='plot-tensor-details'>
            <div
                ref={(el) => assignRef(el, 5)}
                className={classNames('producer-consumer', { hidden: selectedTensor === null })}
            >
                <div
                    className={classNames('title', {
                        hidden: details.getTensorProducerConsumer(selectedTensor).producers.length === 0,
                    })}
                >
                    <Icon
                        size={14}
                        icon={IconNames.EXPORT}
                    />
                    Producers
                </div>
                {details.getTensorProducerConsumer(selectedTensor).producers.map((op) => (
                    <div
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
                    </div>
                ))}

                <div
                    className={classNames('title', {
                        hidden: details.getTensorProducerConsumer(selectedTensor).consumers.length === 0,
                    })}
                >
                    <Icon
                        size={14}
                        icon={IconNames.IMPORT}
                        className='consumer-icon'
                    />{' '}
                    Consumers
                </div>
                {details.getTensorProducerConsumer(selectedTensor).consumers.map((op) => (
                    <div
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
                    </div>
                ))}
            </div>
        </div>
    );
}

export default ProducerConsumers;
