// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// @eslint-disable jsx-a11y/mouse-events-have-key-events

import React, { Fragment, useCallback, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonGroup, ButtonVariant, MenuItem, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import type { ItemRenderer } from '@blueprintjs/select';
import { ItemPredicate, Select } from '@blueprintjs/select';
import Collapsible from '../Collapsible';
import {
    KERNEL_PROCESS,
    NPEData,
    NPERootZone,
    NPEZone,
    NPE_COORDINATES,
    NPE_COORDINATE_INDEX,
    getKernelColor,
} from '../../model/NPEModel';

interface NPEZoneFilterComponentProps {
    npeData: NPEData;
    open: boolean;
    onClose: () => void;
    onSelect: (address: NPE_COORDINATES | null) => void;
    onExpand: (state: boolean, proc: KERNEL_PROCESS, address: NPE_COORDINATES) => void;
    onZoneClick: (zone: NPEZone) => void;
}

const NPEZoneFilterComponent: React.FC<NPEZoneFilterComponentProps> = ({
    npeData,
    open = false,
    onClose,
    onSelect,
    onExpand,
    onZoneClick,
}) => {
    const [selectedDeviceId, setSelectedDeviceId] = React.useState<number | null>(null);
    const [selectedCoreAddress, setSelectedCoreAddress] = React.useState<string | null>(null);
    const sortCoreAddress = useCallback((a: NPERootZone, b: NPERootZone) => {
        const chip = a.core[NPE_COORDINATE_INDEX.CHIP_ID] - b.core[NPE_COORDINATE_INDEX.CHIP_ID];
        if (chip !== 0) {
            return chip;
        }
        const y = a.core[NPE_COORDINATE_INDEX.Y] - b.core[NPE_COORDINATE_INDEX.Y];
        if (y !== 0) {
            return y;
        }
        return a.core[NPE_COORDINATE_INDEX.X] - b.core[NPE_COORDINATE_INDEX.X];
    }, []);

    const filterDeviceId: ItemPredicate<number> = useCallback(
        (query, selected) => !query || String(selected).toLowerCase().includes(query.toLowerCase()),
        [],
    );
    const filterCoreAddress: ItemPredicate<string> = useCallback(
        (query, selected) => !query || String(selected).toLowerCase().includes(query.toLowerCase()),
        [],
    );
    const uniqueDeviceIdList = useMemo(() => {
        const deviceSet = new Set<number>();
        npeData.zones?.forEach((tensor) => {
            deviceSet.add(tensor.core[NPE_COORDINATE_INDEX.CHIP_ID]);
        });
        return Array.from(deviceSet).sort();
    }, [npeData.zones]);

    const coreAddressList = useMemo(() => {
        const addresses =
            npeData.zones
                ?.filter(
                    (zone) => zone.core[NPE_COORDINATE_INDEX.CHIP_ID] === selectedDeviceId || selectedDeviceId === null,
                )
                .sort(sortCoreAddress)
                .map((rootZone) => rootZone.core.join('-')) || [];
        return [...new Set([...addresses])];
    }, [npeData.zones, sortCoreAddress, selectedDeviceId]);

    const sortedFilteredZones = useMemo(() => {
        return [...(npeData.zones || [])]
            .sort(sortCoreAddress)
            .filter((zone) => zone.core[NPE_COORDINATE_INDEX.CHIP_ID] === selectedDeviceId || selectedDeviceId === null)
            .filter((zone) => zone.core.join('-') === selectedCoreAddress || selectedCoreAddress === null);
    }, [npeData.zones, sortCoreAddress, selectedDeviceId, selectedCoreAddress]);

    const getZoneElements = (
        zones: NPEZone[],
        core: NPE_COORDINATES,
        depth: number = 0,
    ): React.JSX.Element | React.JSX.Element[] => {
        return zones.map((zone, index) => {
            return (
                <Fragment key={`${zone.id}-start-${index}`}>
                    {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
                    <div
                        className={`zone-interactive  depth-${depth}`}
                        style={{ marginLeft: `${depth * 20}px` }}
                        onClick={() => {
                            onZoneClick(zone);
                        }}
                    >
                        {zone.id} <span className='zone-timeline-range'>{`${zone.start} - ${zone.end}`}</span>
                    </div>
                    {getZoneElements(zone.zones, core, depth + 1)}
                </Fragment>
            );
        });
    };

    const coreItemRenderer = useMemo(() => coreAddressItemRenderer(selectedCoreAddress), [selectedCoreAddress]);
    const deviceItemRenderer = useMemo(() => deviceIdItemRenderer(selectedDeviceId), [selectedDeviceId]);

    const onExpandStateChange = (state: boolean, proc: KERNEL_PROCESS, address: NPE_COORDINATES) => {
        onExpand(state, proc, address);
    };
    return (
        <div className={classNames('zones-renderer', { open })}>
            <div className='zones-controls'>
                <h3>
                    Zones{' '}
                    <Button
                        variant={ButtonVariant.MINIMAL}
                        onClick={onClose}
                        icon={IconNames.CHEVRON_LEFT}
                        aria-label='Close zones panel'
                    />
                </h3>
                <ButtonGroup className='zone-filters'>
                    <Select
                        className='device-selector'
                        items={uniqueDeviceIdList}
                        itemRenderer={deviceItemRenderer}
                        filterable
                        itemPredicate={filterDeviceId}
                        noResults={
                            <MenuItem
                                disabled
                                text='No results'
                                roleStructure='listoption'
                            />
                        }
                        onItemSelect={(id) => {
                            onSelect(null);
                            setSelectedCoreAddress(null);
                            setSelectedDeviceId(id);
                        }}
                    >
                        <Button
                            variant={ButtonVariant.OUTLINED}
                            text={selectedDeviceId !== null ? `Device ${selectedDeviceId}` : 'Filter device'}
                        />
                    </Select>
                    <Select
                        className='core-selector'
                        items={coreAddressList}
                        itemRenderer={coreItemRenderer}
                        disabled={selectedDeviceId === null}
                        filterable
                        itemPredicate={filterCoreAddress}
                        noResults={
                            <MenuItem
                                disabled
                                text='No results'
                                roleStructure='listoption'
                            />
                        }
                        onItemSelect={(item) => {
                            setSelectedCoreAddress(item);
                            const coords = item.split('-').map((coord) => parseInt(coord, 10));
                            onSelect(coords as NPE_COORDINATES);
                        }}
                    >
                        <Button
                            variant={ButtonVariant.OUTLINED}
                            disabled={selectedDeviceId === null}
                            text={selectedCoreAddress ? `${selectedCoreAddress}` : 'Filter cores'}
                        />
                    </Select>
                    <Tooltip
                        content='Clear filters'
                        disabled={selectedDeviceId === null && selectedCoreAddress === null}
                    >
                        <Button
                            variant={ButtonVariant.OUTLINED}
                            disabled={selectedDeviceId === null && selectedCoreAddress === null}
                            icon={IconNames.CROSS}
                            onClick={() => {
                                setSelectedDeviceId(null);
                                setSelectedCoreAddress(null);
                                onSelect(null);
                            }}
                        />
                    </Tooltip>
                </ButtonGroup>
            </div>
            <div className='zones-container'>
                {sortedFilteredZones.map((rootZone) => {
                    return (
                        <Collapsible
                            collapseClassName='root-zone-collapsible'
                            key={`${rootZone.proc}-${rootZone.core.join('-')}`}
                            label={
                                <div className='root-zone-label'>
                                    <span
                                        className='color-square'
                                        style={{ backgroundColor: getKernelColor(rootZone.proc) }}
                                    />
                                    {rootZone.proc} {rootZone.core.join('-')}
                                </div>
                            }
                            isOpen={false}
                            onExpandToggle={(state) => {
                                onExpandStateChange(state, rootZone.proc, rootZone.core);
                            }}
                        >
                            <div>{getZoneElements(rootZone.zones, rootZone.core, 1)}</div>
                        </Collapsible>
                    );
                })}
            </div>
        </div>
    );
};

const coreAddressItemRenderer =
    (selected: string | null): ItemRenderer<string> =>
    (id, { handleClick }) => (
        <MenuItem
            key={id}
            text={id}
            roleStructure='listoption'
            onClick={handleClick}
            active={id === selected}
            icon={id === selected ? IconNames.TICK : IconNames.BLANK}
        />
    );

const deviceIdItemRenderer =
    (selected: number | null): ItemRenderer<number> =>
    (id, { handleClick }) => (
        <MenuItem
            key={id}
            text={`Device ${id}`}
            roleStructure='listoption'
            onClick={handleClick}
            active={id === selected}
            icon={id === selected ? IconNames.TICK : IconNames.BLANK}
        />
    );
export default NPEZoneFilterComponent;
