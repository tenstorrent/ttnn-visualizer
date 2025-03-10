// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import classNames from 'classnames';
import { Button, Checkbox, MenuItem } from '@blueprintjs/core';
import { Select } from '@blueprintjs/select';
import { useAtom } from 'jotai';
import { IconNames } from '@blueprintjs/icons';
import { useDevices } from '../hooks/useAPI';
import { selectedDeviceAtom } from '../store/app';
import isValidNumber from '../functions/isValidNumber';
import 'styles/components/DeviceSelector.scss';

// KEEPING THIS FOR NOW - Device selection works differently than we thought but we might reuse this in the future

function DeviceSelector() {
    const { data: devices } = useDevices();

    const items = devices ? devices.map((device) => device.device_id) : [];
    const [selectedDevice, setSelectedDevice] = useAtom(selectedDeviceAtom);

    const updateSelectedDevices = (device?: number) => {
        setSelectedDevice(device !== undefined && device !== selectedDevice ? device : null);
    };

    return devices && devices?.length > 1 ? (
        <Select
            className={classNames('device-selector', {
                'has-selection': selectedDevice !== undefined,
            })}
            items={items}
            itemRenderer={(value) => DeviceItem(value, updateSelectedDevices, selectedDevice)}
            filterable
            itemPredicate={(query, device) => device.toString().indexOf(query) >= 0}
            noResults={
                <MenuItem
                    disabled
                    text='No results.'
                    roleStructure='listoption'
                />
            }
            onItemSelect={updateSelectedDevices}
        >
            <Button
                text={isValidNumber(selectedDevice) ? `Device ${selectedDevice}` : 'Select device...'}
                icon={isValidNumber(selectedDevice) ? IconNames.SMALL_SQUARE : null}
                variant='outlined'
            />
        </Select>
    ) : null;
}

const DeviceItem = (device: number, onClick: (device: number) => void, selectedDevice: number | null) => {
    return (
        <li key={device}>
            <Checkbox
                className='buffer-type-checkbox'
                label={`Device ${device}`}
                checked={selectedDevice === device}
                onClick={() => onClick(device)}
            />
        </li>
    );
};

export default DeviceSelector;
