// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import { useEffect, useState } from 'react';
import axios from 'axios';
import SearchField from './SearchField';
import FilterableComponent from './FilterableComponent';
import Collapsible from './Collapsible';
import OperationComponent from './OperationComponent';
import { Operation } from '../model/Graph.ts';

const OperationList = () => {
    const [operations, setOperations] = useState([] as Operation[]);
    useEffect(() => {
        const fetchOperations = async () => {
            const response = await axios.get('/api/get-operations');
            return response.data;
        };

        fetchOperations()
            // eslint-disable-next-line promise/always-return
            .then((data) => {
                // console.log(data);
                setOperations(data);
            })
            .catch((error) => {
                console.error('Error fetching operations:', error);
            });
    }, []);

    const [filterQuery, setFilterQuery] = useState('');

    return (
        <div className='app'>
            <fieldset className='operations-wrap'>
                <legend>Operations</legend>

                <div className='ops'>
                    <SearchField
                        placeholder='Filter operations'
                        searchQuery={filterQuery}
                        onQueryChanged={setFilterQuery}
                        controls={
                            [
                                // <Tooltip2
                                //     content='Select all filtered operations'
                                //     position={PopoverPosition.RIGHT}
                                //     key='select-all-ops'
                                // >
                                //     <Button icon={IconNames.CUBE_ADD}/>
                                // </Tooltip2>,
                                // <Tooltip2
                                //     content='Deselect all filtered operations'
                                //     position={PopoverPosition.RIGHT}
                                //     key='deselect-all-ops'
                                // >
                                //     <Button
                                //         icon={IconNames.CUBE_REMOVE}
                                //
                                //     />
                                // </Tooltip2>,
                            ]
                        }
                    />
                    {operations.map((operation) => {
                        return (
                            <FilterableComponent
                                key={operation.id}
                                filterableString={operation.name}
                                filterQuery={filterQuery}
                                component={
                                    <div className='op'>
                                        <Collapsible
                                            label={<OperationComponent operation={operation} filterQuery={filterQuery} />}
                                            isOpen={false}
                                        >
                                            {operation.arguments && (
                                                <div className='collapsible-content'>
                                                    <ul className='op-params'>
                                                        {operation.arguments.map((arg) => (
                                                            <li key={operation.id + arg.name}>
                                                                <strong>{arg.name}: </strong>
                                                                <pre>{arg.value}</pre>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </Collapsible>
                                    </div>
                                }
                            />
                        );
                    })}
                </div>
            </fieldset>
        </div>
    );
};

export default OperationList;
