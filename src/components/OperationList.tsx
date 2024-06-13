// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import { useState } from 'react';
import axios, { AxiosError } from 'axios';
import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import SearchField from './SearchField';
import FilterableComponent from './FilterableComponent';
import Collapsible from './Collapsible';
import OperationComponent from './OperationComponent';
import { Operation } from '../model/Graph.ts';

const OperationList = () => {
    // useEffect(() => {
    //     const fetchOperations = async () => {
    //         const response = await axios.get('/api/get-operations');
    //         return response.data;
    //     };
    //
    //     fetchOperations()
    //         // eslint-disable-next-line promise/always-return
    //         .then((data) => {
    //             // console.log(data);
    //             setOperations(data);
    //         })
    //         .catch((error) => {
    //             console.error('Error fetching operations:', error);
    //         });
    // }, []);

    const fetchOperations = async () => {
        const { data } = await axios.get('/api/get-operations');
        return data;
    };
    const { data, error, isLoading } = useQuery<Operation[], AxiosError>('get-operations', fetchOperations);

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
                    {isLoading && <div>Loading...</div>}
                    {error && <div>An error occurred: {error.message}</div>}
                    {data &&
                        data.map((operation) => {
                            return (
                                <FilterableComponent
                                    key={operation.id}
                                    filterableString={operation.name}
                                    filterQuery={filterQuery}
                                    component={
                                        <div className='op'>
                                            <Collapsible
                                                label={
                                                    <OperationComponent
                                                        operation={operation}
                                                        filterQuery={filterQuery}
                                                    />
                                                }
                                                additionalElements={
                                                    <Link to={`/operations/${operation.id}`}>
                                                        <Button
                                                            title='Buffer view'
                                                            minimal
                                                            small
                                                            className='buffer-view'
                                                            icon={IconNames.SEGMENTED_CONTROL}
                                                        />
                                                    </Link>
                                                }
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
