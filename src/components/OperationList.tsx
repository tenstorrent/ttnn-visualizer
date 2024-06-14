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
import { Operation } from '../model/Graph';
import OperationArguments from './OperationArguments';

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
                        onQueryChanged={(value) => setFilterQuery(value)}
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
                                                keepChildrenMounted={false}
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
                                                <div className='arguments-wrapper'>
                                                    {operation.arguments && (
                                                        <OperationArguments data={operation.arguments} />
                                                    )}
                                                </div>
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

// function formatArguments(args: Array<Object>) {
//     const formattedArguments = [];
//     const shapeRegex = new RegExp(/shape=(Shape\(\[.*\]\))/);
//     const argumentRegex = new RegExp(/(\S*)=((?:(?!,|\)").)*)/g);

//     args.forEach((a) => {
//         let m;

//         while ((m = argumentRegex.exec(a.value)) !== null) {
//             // This is necessary to avoid infinite loops with zero-width matches
//             if (m.index === argumentRegex.lastIndex) {
//                 argumentRegex.lastIndex++;
//             }

//             a[m[1]] = m[2];

//             // The result can be accessed through the `m`-variable.
//             // m.forEach((match, groupIndex) => {
//             //     console.log(`Found match, group ${groupIndex}: ${match}`);
//             //     if (groupIndex !== 0) {
//             //         formattedArguments.push({
//             //             name: a.name,
//             //             arguments: shape && shape[1],
//             //         });
//             //     }
//             // });
//         }

//         formattedArguments.push(a);
//     });

//     return formattedArguments;
// }

export default OperationList;
