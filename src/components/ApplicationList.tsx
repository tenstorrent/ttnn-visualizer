// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import { useEffect, useState } from 'react';
import axios from 'axios';
import SearchField from './SearchField';
import FilterableComponent from './FilterableComponent';
import Collapsible from './Collapsible';
import OperationComponent from './OperationComponent';

interface Operation {
    id: string;
    name: string;
    duration: number;
    arguments: { name: string; value: string }[];
}

const ApplicationList = () => {
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
                    {operations.map((op) => {
                        return (
                            <FilterableComponent
                                key={op.id}
                                filterableString={op.name}
                                filterQuery={filterQuery}
                                component={
                                    <div className='op'>
                                        <Collapsible
                                            label={<OperationComponent op={op} filterQuery={filterQuery} />}
                                            isOpen={false}
                                        >
                                            {op.arguments && (
                                                <div className='collapsible-content'>
                                                    <ul className='op-params'>
                                                        {op.arguments.map((arg, index) => (
                                                            <li key={op.id + arg.name + index}>
                                                                <strong>{arg.name}: </strong>
                                                                {arg.value}
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

export default ApplicationList;
