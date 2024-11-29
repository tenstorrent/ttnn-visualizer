// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { MEMORY_CONFIG_HEADERS, MemoryKeys, ShardSpec, getMemoryConfigHeader } from '../functions/parseMemoryConfig';

interface MemoryConfigRowProps {
    header: string;
    value: string | ShardSpec;
}

const MemoryConfigRow = ({ header, value }: MemoryConfigRowProps) => {
    return (
        <tr>
            {header === 'shard_spec' && typeof value === 'object' ? (
                <>
                    <th>{MEMORY_CONFIG_HEADERS[header]}</th>
                    <td>
                        <table className='ttnn-table alt-two-tone-rows'>
                            <tbody>
                                {Object.entries(value as ShardSpec).map(([innerKey, innerValue]) => (
                                    <tr key={innerKey}>
                                        <th>{getMemoryConfigHeader(innerKey as MemoryKeys)}</th>
                                        <td>{innerValue}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </td>
                </>
            ) : (
                <>
                    <th>{getMemoryConfigHeader(header as MemoryKeys)}</th>
                    <td>{value as string}</td>
                </>
            )}
        </tr>
    );
};

export default MemoryConfigRow;
