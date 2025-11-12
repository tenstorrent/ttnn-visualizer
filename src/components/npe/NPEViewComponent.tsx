// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
// @eslint-disable jsx-a11y/mouse-events-have-key-events

import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/NPEComponent.scss';
import 'styles/components/NPEZoneFilterComponent.scss';
import React, { useEffect, useMemo, useState } from 'react';
import { Button, ButtonGroup, ButtonVariant, Intent, Size, Slider, Switch } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { Fragment } from 'react/jsx-runtime';
import { useAtom } from 'jotai';
import {
    EVENT_TYPE_FILTER,
    FABRIC_EVENT_SCOPE_OPTIONS,
    FabricEventScopeColors,
    KERNEL_PROCESS,
    NPEData,
    NPERootZone,
    NPERootZoneUXInfo,
    NPEZone,
    NPE_COORDINATES,
    NPE_COORDINATE_INDEX,
    NPE_LINK,
    NoCFlowBase,
    NoCTransfer,
    NoCType,
    SelectedNode,
} from '../../model/NPEModel';
import TensixTransferRenderer from './TensixTransferRenderer';
import {
    NODE_SIZE,
    calculateFabricColor,
    calculateLinkCongestionColor,
    getLines,
    getLinkPoints,
    resetRouteColors,
} from './drawingApi';
import NPETimelineComponent from './NPETimelineComponent';
import ActiveTransferDetails from './ActiveTransferDetails';
import { useNodeType } from '../../hooks/useAPI';
import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';
import { CLUSTER_COORDS } from '../../model/ClusterModel';
import NPEMetadata from './NPEMetadata';
import { EmptyChipRenderer } from './EmptyChipRenderer';
import { RouteOriginsRenderer } from './RouteOriginsRenderer';
import { useSelectedTransferGrouping, useShowActiveTransfers } from './useNPEHandlers';
import { altCongestionColorsAtom } from '../../store/app';
import GlobalSwitch from '../GlobalSwitch';
import NPEZoneFilterComponent from './NPEZoneFilterComponent';

interface NPEViewProps {
    npeData: NPEData;
}

const LABEL_STEP_THRESHOLD = 25;
const RIGHT_MARGIN_OFFSET_PX = 25;
const TENSIX_SIZE: number = NODE_SIZE; // * 0.75;
const SVG_SIZE = TENSIX_SIZE;
const PLAYBACK_SPEED = 1;
const PLAYBACK_SPEED_2X = 2;

const LABEL_STEP_COUNT_TIMESTEPSCALE = 20;
const LABEL_STEP_COUNT_CYCLESCALE = 10;

enum VISUALIZATION_MODE {
    CONGESTION,
    TRANSFERS,
}

type RootzoneStateKey = string;
const getRootZoneKey = (proc: KERNEL_PROCESS, address: NPE_COORDINATES): RootzoneStateKey => {
    return `${proc}:${address.join(',')}`;
};

const NPEView: React.FC<NPEViewProps> = ({ npeData }) => {
    const [highlightedTransfer, setHighlightedTransfer] = useState<NoCTransfer | null>(null);
    const [highlightedRoute, setHighlightedRoute] = useState<number | null>(null);
    const [selectedTimestep, setSelectedTimestep] = useState<number>(0);
    const [animationInterval, setAnimationInterval] = useState<number | null>(null);
    const [selectedTransferList, setSelectedTransferList] = useState<NoCTransfer[]>([]);
    const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(0);
    const [visualizationMode, setVisualizationMode] = useState<VISUALIZATION_MODE>(VISUALIZATION_MODE.CONGESTION);
    const [openZonesPanel, setOpenZonesPanel] = useState<boolean>(false);
    const [selectedZoneAddress, setSelectedZoneAddress] = useState<NPE_COORDINATES | null>(null);
    const [expandedZoneMap, setExpandedZoneMap] = useState<Record<RootzoneStateKey, boolean>>({});
    const [canvasWidth, setCanvasWidth] = useState(window.innerWidth);
    const [isShowingAllTransfers, setIsShowingAllTransfers] = useState<boolean>(false);
    const [isAnnotatingCores, setIsAnnotatingCores] = useState<boolean>(true);
    const [nocFilter, setNocFilter] = useState<NoCType | null>(null);
    const [altCongestionColors, setAltCongestionColors] = useAtom(altCongestionColorsAtom);
    const [fabricEventsFilter, setFabricEventsFilter] = useState<EVENT_TYPE_FILTER>(EVENT_TYPE_FILTER.ALL_EVENTS);
    const [timestepsScale, setTimestepsScale] = useState<boolean>(true);
    const [zoom, setZoom] = useState<number>(0.75);

    let totalColsChips = 0;
    const chips = Object.entries(npeData.chips).map(([ClusterChipId, coords]) => {
        totalColsChips = Math.max(totalColsChips, coords[CLUSTER_COORDS.X]);
        return {
            id: parseInt(ClusterChipId, 10),
            coords,
        };
    });

    const zones: NPERootZone[] = useMemo(() => {
        return npeData.zones || [];
    }, [npeData]);

    const isFabricTransfersFilteringEnabled = useMemo(() => {
        return npeData.noc_transfers.some((tr) => tr.fabric_event_type);
    }, [npeData]);

    useEffect(() => {
        if (!isFabricTransfersFilteringEnabled && fabricEventsFilter !== EVENT_TYPE_FILTER.ALL_EVENTS) {
            setFabricEventsFilter(EVENT_TYPE_FILTER.ALL_EVENTS);
        }
    }, [fabricEventsFilter, isFabricTransfersFilteringEnabled]);

    const selectedZoneList: NPERootZoneUXInfo[] = useMemo(() => {
        if (selectedZoneAddress === null) {
            return [];
        }
        return zones
            .filter((rootZone) => {
                return (
                    rootZone.core[NPE_COORDINATE_INDEX.CHIP_ID] === selectedZoneAddress[NPE_COORDINATE_INDEX.CHIP_ID] &&
                    rootZone.core[NPE_COORDINATE_INDEX.Y] === selectedZoneAddress[NPE_COORDINATE_INDEX.Y] &&
                    rootZone.core[NPE_COORDINATE_INDEX.X] === selectedZoneAddress[NPE_COORDINATE_INDEX.X]
                );
            })
            .map(
                (rootZone): NPERootZoneUXInfo => ({
                    ...rootZone,
                    expandedState: expandedZoneMap[getRootZoneKey(rootZone.proc, rootZone.core)] ?? false,
                }),
            );
    }, [expandedZoneMap, selectedZoneAddress, zones]);

    const links = useMemo(() => {
        const timestepData = npeData.timestep_data[selectedTimestep];
        timestepData.active_transfers.forEach((id) => {
            const transfer = npeData.noc_transfers.find((tr) => tr.id === id);
            // TODO: this functionality should MAYBE move to BE. https://github.com/orgs/tenstorrent/projects/178/views/1?pane=issue&itemId=124188622&issue=tenstorrent%7Cttnn-visualizer%7C745
            if (
                transfer &&
                (fabricEventsFilter !== EVENT_TYPE_FILTER.ALL_EVENTS ||
                    visualizationMode === VISUALIZATION_MODE.TRANSFERS)
            ) {
                transfer.route.forEach((route) => {
                    route.links.forEach((link) => {
                        timestepData.link_demand.forEach((linkDemand) => {
                            if (
                                linkDemand[NPE_LINK.CHIP_ID] === link[NPE_LINK.CHIP_ID] &&
                                linkDemand[NPE_LINK.NOC_ID] === link[NPE_LINK.NOC_ID] &&
                                linkDemand[NPE_LINK.Y] === link[NPE_LINK.Y] &&
                                linkDemand[NPE_LINK.X] === link[NPE_LINK.X]
                            ) {
                                const targetFabric = transfer.fabric_event_type
                                    ? FABRIC_EVENT_SCOPE_OPTIONS.FABRIC
                                    : FABRIC_EVENT_SCOPE_OPTIONS.LOCAL;
                                if (linkDemand[NPE_LINK.FABRIC_EVENT_SCOPE] === undefined) {
                                    linkDemand[NPE_LINK.FABRIC_EVENT_SCOPE] = targetFabric;
                                } else if (linkDemand[NPE_LINK.FABRIC_EVENT_SCOPE] !== targetFabric) {
                                    linkDemand[NPE_LINK.FABRIC_EVENT_SCOPE] = FABRIC_EVENT_SCOPE_OPTIONS.BOTH;
                                }
                            }
                        });
                    });
                });
            }
        });

        return timestepData;
    }, [npeData.timestep_data, npeData.noc_transfers, selectedTimestep, fabricEventsFilter, visualizationMode]);

    const transfers = useMemo(() => {
        return npeData.noc_transfers
            .filter((tr) => links?.active_transfers.includes(tr.id))
            .filter((tr) => {
                if (fabricEventsFilter === EVENT_TYPE_FILTER.ALL_EVENTS) {
                    return true;
                }
                if (fabricEventsFilter === EVENT_TYPE_FILTER.FABRIC_EVENTS) {
                    return tr.fabric_event_type === true;
                }
                if (fabricEventsFilter === EVENT_TYPE_FILTER.LOCAL_EVENTS) {
                    return tr.fabric_event_type !== true;
                }
                return true;
            });
    }, [npeData.noc_transfers, links?.active_transfers, fabricEventsFilter]);

    const showNOCType = (value: NoCType) => {
        if (nocFilter === null) {
            setNocFilter(value === NoCType.NOC0 ? NoCType.NOC1 : NoCType.NOC0);
        } else if (nocFilter !== value) {
            setNocFilter(null);
        } else {
            setNocFilter(value === NoCType.NOC0 ? NoCType.NOC1 : NoCType.NOC0);
        }
    };

    useEffect(() => {
        const handleResize = () => setCanvasWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const { architecture, cores, dram, eth, pcie } = useNodeType(npeData.common_info.arch as DeviceArchitecture);
    const width = architecture.grid?.x_size || 10;
    const height = architecture.grid?.y_size || 12;

    useEffect(() => {
        resetRouteColors();
        if (isShowingAllTransfers) {
            showAllTransfers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTimestep, isShowingAllTransfers]);

    useEffect(() => {
        stopAnimation();
        setSelectedTimestep(0);
        setSelectedNode(null);
        setSelectedTransferList([]);
        setHighlightedTransfer(null);
        setHighlightedRoute(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [npeData]);

    const { transferListSelectionRendering, groupedTransfersByNoCID } = useSelectedTransferGrouping(
        selectedTransferList,
        selectedNode,
    );

    const startAnimation = (speed: number = PLAYBACK_SPEED) => {
        setPlaybackSpeed(speed);
        clearInterval(animationInterval as number);
        const range = npeData.timestep_data.length;

        const interval = setInterval(() => {
            setSelectedTimestep((prev) => {
                return prev < range - 1 ? prev + 1 : 0;
            });
        }, 100 / speed);
        setAnimationInterval(Number(interval));
    };

    const stopAnimation = () => {
        setPlaybackSpeed(0);
        return clearInterval(animationInterval as number);
    };

    const onPlay = () => {
        startAnimation();
    };

    const onPlay2x = () => {
        startAnimation(PLAYBACK_SPEED_2X);
    };

    const onPause = () => {
        stopAnimation();
    };

    const onBackward = () => {
        const range = npeData.timestep_data.length;
        stopAnimation();
        setSelectedNode(null);
        setSelectedTransferList([]);
        setSelectedTimestep((prev) => (prev > 0 ? prev - 1 : range - 1));
    };

    const onForward = () => {
        const range = npeData.timestep_data.length;
        stopAnimation();
        setSelectedNode(null);
        setSelectedTransferList([]);
        setSelectedTimestep((prev) => (prev < range - 1 ? prev + 1 : 0));
    };

    const onHandleZoneNavigation = (zone: NPEZone) => {
        const timestep = Math.floor(zone.start / (npeData.common_info.cycles_per_timestep ?? 1));
        setSelectedTimestep(timestep);
    };

    const handleScrubberChange = (value: number) => {
        stopAnimation();
        setSelectedTimestep(value);
        setSelectedNode(null);
        setSelectedTransferList([]);
    };

    const hideAllTransfers = () => {
        setIsShowingAllTransfers(false);
        setSelectedTransferList([]);
    };

    const showActiveTransfers = useShowActiveTransfers({
        npeData,
        selectedNode,
        selectedTimestep,
        nocFilter,
        onPause,
        hideAllTransfers,
        setSelectedNode,
        setSelectedTransferList,
    });

    const showAllTransfers = () => {
        setIsShowingAllTransfers(true);
        setSelectedNode(null);
        const activeTransfers = npeData.timestep_data[selectedTimestep].active_transfers
            .map((transferId) => npeData.noc_transfers.find((tr) => tr.id === transferId))
            .filter((transfer): transfer is NoCTransfer => transfer !== undefined);
        setSelectedTransferList(activeTransfers as NoCTransfer[]);
    };

    const getOriginOpacity = (transfer: NoCFlowBase): number => {
        if (transfer.id === null || transfer.id === undefined) {
            return 1;
        }
        if (isShowingAllTransfers) {
            return 0;
        }
        if (highlightedTransfer !== null && highlightedTransfer.id === transfer.id) {
            return 1;
        }
        if (highlightedTransfer !== null) {
            return 0;
        }
        if (selectedTransferList.length === 0) {
            return 0;
        }
        const isSelected = selectedTransferList.some((t) => t.id === transfer.id);

        if (selectedTransferList.length !== 0 && !isSelected) {
            return 0;
        }

        return 0.5;
    };

    const switchWidth = canvasWidth - canvasWidth / npeData.timestep_data.length - RIGHT_MARGIN_OFFSET_PX;
    const isTimelinePlaying = playbackSpeed > 0;
    const isActiveTransferDetailsOpen = !!(selectedNode && !isTimelinePlaying && selectedTransferList?.length > 0);

    return (
        <div className='npe'>
            <NPEMetadata
                info={npeData.common_info}
                numTransfers={transfers.length}
            />

            <div className='header'>
                <ButtonGroup className='npe-controls'>
                    <div className='npe-controls-line'>
                        <Button
                            icon={IconNames.StepBackward}
                            onClick={onBackward}
                        />
                        <Button
                            icon={isTimelinePlaying ? IconNames.Pause : IconNames.Play}
                            intent={playbackSpeed === PLAYBACK_SPEED ? Intent.PRIMARY : Intent.NONE}
                            onClick={isTimelinePlaying ? onPause : onPlay}
                        />
                        <Button
                            icon={IconNames.FastForward}
                            onClick={onPlay2x}
                            intent={playbackSpeed === PLAYBACK_SPEED_2X ? Intent.PRIMARY : Intent.NONE}
                        />
                        <Button
                            icon={IconNames.StepForward}
                            onClick={onForward}
                        />
                        |
                        <Switch
                            label='Show all active transfers'
                            checked={isShowingAllTransfers}
                            onChange={() => (isShowingAllTransfers ? hideAllTransfers() : showAllTransfers())}
                        />
                        <Switch
                            label='Annotate cores'
                            checked={isAnnotatingCores}
                            onChange={() => setIsAnnotatingCores(!isAnnotatingCores)}
                        />
                        <ButtonGroup
                            variant={ButtonVariant.OUTLINED}
                            size={Size.SMALL}
                        >
                            <Button
                                text='Timesteps'
                                icon={timestepsScale ? IconNames.ENDORSED : IconNames.CIRCLE}
                                active={timestepsScale}
                                onClick={() => setTimestepsScale(true)}
                            />
                            <Button
                                text='Cycles'
                                icon={!timestepsScale ? IconNames.ENDORSED : IconNames.CIRCLE}
                                active={!timestepsScale}
                                onClick={() => setTimestepsScale(false)}
                            />
                        </ButtonGroup>
                    </div>
                    <div className='npe-controls-line'>
                        <Button
                            text='Zones'
                            className='zones-open-panel-btn'
                            icon={IconNames.MultiSelect}
                            active={openZonesPanel}
                            onClick={() => setOpenZonesPanel(true)}
                            disabled={!npeData.zones}
                        />
                        <ButtonGroup
                            variant={ButtonVariant.OUTLINED}
                            size={Size.SMALL}
                        >
                            <Button
                                text='Congestion Mode'
                                icon={
                                    visualizationMode === VISUALIZATION_MODE.CONGESTION
                                        ? IconNames.ENDORSED
                                        : IconNames.CIRCLE
                                }
                                active={visualizationMode === VISUALIZATION_MODE.CONGESTION}
                                onClick={() => setVisualizationMode(VISUALIZATION_MODE.CONGESTION)}
                            />
                            <Button
                                text='Transfers Scope Mode'
                                icon={
                                    visualizationMode === VISUALIZATION_MODE.TRANSFERS
                                        ? IconNames.ENDORSED
                                        : IconNames.CIRCLE
                                }
                                active={visualizationMode === VISUALIZATION_MODE.TRANSFERS}
                                onClick={() => setVisualizationMode(VISUALIZATION_MODE.TRANSFERS)}
                            />
                        </ButtonGroup>
                        <GlobalSwitch
                            label='Alternate congestion colors'
                            checked={altCongestionColors}
                            onChange={() => setAltCongestionColors(!altCongestionColors)}
                        />
                    </div>
                    <div className='npe-controls-line'>
                        <Switch
                            label='NOC0'
                            checked={nocFilter === NoCType.NOC0 || nocFilter === null}
                            onChange={() => showNOCType(NoCType.NOC0)}
                        />
                        <Switch
                            label='NOC1'
                            checked={nocFilter === NoCType.NOC1 || nocFilter === null}
                            onChange={() => showNOCType(NoCType.NOC1)}
                        />
                        <Switch
                            labelElement={
                                <>
                                    <div
                                        className='color-square'
                                        style={{
                                            backgroundColor: FabricEventScopeColors[FABRIC_EVENT_SCOPE_OPTIONS.FABRIC],
                                        }}
                                    />{' '}
                                    Fabric events
                                </>
                            }
                            checked={
                                fabricEventsFilter === EVENT_TYPE_FILTER.FABRIC_EVENTS ||
                                fabricEventsFilter === EVENT_TYPE_FILTER.ALL_EVENTS
                            }
                            disabled={!isFabricTransfersFilteringEnabled}
                            onChange={() => {
                                if (fabricEventsFilter === EVENT_TYPE_FILTER.ALL_EVENTS) {
                                    setFabricEventsFilter(EVENT_TYPE_FILTER.LOCAL_EVENTS);
                                } else if (fabricEventsFilter === EVENT_TYPE_FILTER.LOCAL_EVENTS) {
                                    setFabricEventsFilter(EVENT_TYPE_FILTER.ALL_EVENTS);
                                } else if (fabricEventsFilter === EVENT_TYPE_FILTER.FABRIC_EVENTS) {
                                    setFabricEventsFilter(EVENT_TYPE_FILTER.LOCAL_EVENTS);
                                }
                            }}
                        />
                        <Switch
                            labelElement={
                                <>
                                    <div
                                        className='color-square'
                                        style={{
                                            backgroundColor: FabricEventScopeColors[FABRIC_EVENT_SCOPE_OPTIONS.LOCAL],
                                        }}
                                    />{' '}
                                    Local events
                                </>
                            }
                            checked={
                                fabricEventsFilter === EVENT_TYPE_FILTER.LOCAL_EVENTS ||
                                fabricEventsFilter === EVENT_TYPE_FILTER.ALL_EVENTS
                            }
                            disabled={!isFabricTransfersFilteringEnabled}
                            onChange={() => {
                                if (fabricEventsFilter === EVENT_TYPE_FILTER.ALL_EVENTS) {
                                    setFabricEventsFilter(EVENT_TYPE_FILTER.FABRIC_EVENTS);
                                } else if (fabricEventsFilter === EVENT_TYPE_FILTER.FABRIC_EVENTS) {
                                    setFabricEventsFilter(EVENT_TYPE_FILTER.ALL_EVENTS);
                                } else if (fabricEventsFilter === EVENT_TYPE_FILTER.LOCAL_EVENTS) {
                                    setFabricEventsFilter(EVENT_TYPE_FILTER.FABRIC_EVENTS);
                                }
                            }}
                        />
                        |{/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                        <label>
                            Zoom
                            <Slider
                                aria-label='zoom'
                                min={0.1}
                                max={2}
                                stepSize={0.1}
                                labelStepSize={1}
                                value={zoom}
                                onChange={(value: number) => setZoom(value)}
                                labelRenderer={(value) => `${value.toFixed(1)}`}
                            />
                        </label>
                    </div>
                </ButtonGroup>
                <div style={{ position: 'relative', width: `${switchWidth}px` }}>
                    <Slider
                        handleHtmlProps={{ 'aria-label': 'Timeline scrubber' }}
                        min={0}
                        max={npeData.timestep_data.length - 1}
                        stepSize={1}
                        labelStepSize={
                            npeData.timestep_data.length > LABEL_STEP_THRESHOLD
                                ? npeData.timestep_data.length /
                                  (timestepsScale ? LABEL_STEP_COUNT_TIMESTEPSCALE : LABEL_STEP_COUNT_CYCLESCALE)
                                : 1
                        }
                        labelRenderer={(value: number) =>
                            timestepsScale
                                ? value.toFixed(0)
                                : ((npeData.common_info.cycles_per_timestep ?? 1) * value).toFixed(0)
                        }
                        value={selectedTimestep}
                        onChange={(value: number) => handleScrubberChange(value)}
                    />
                    <div
                        className='bp6-slider-progress duplicate'
                        style={{ width: `${canvasWidth - RIGHT_MARGIN_OFFSET_PX}px` }}
                    />
                </div>
                <NPETimelineComponent
                    timestepList={npeData.timestep_data}
                    canvasWidth={canvasWidth}
                    currentTimestep={selectedTimestep}
                    useTimesteps={timestepsScale}
                    cyclesPerTimestep={npeData.common_info.cycles_per_timestep ?? 1}
                    selectedZoneList={selectedZoneList}
                    nocType={nocFilter}
                    navigationCallback={setSelectedTimestep}
                />
            </div>
            <div className='split-grid'>
                <div
                    className={classNames('chip-cluster-wrap', {
                        'details-open': isActiveTransferDetailsOpen,
                    })}
                    style={{
                        gridTemplateColumns: `repeat(${totalColsChips || 0}, ${(TENSIX_SIZE + 1) * width}px)`,
                        zoom,
                    }}
                >
                    {chips.map((clusterChip) => {
                        return (
                            <div
                                className='chip'
                                key={`chip-${clusterChip.id}`}
                                style={{
                                    gridColumn: clusterChip.coords[CLUSTER_COORDS.X] + 1,
                                    gridRow: clusterChip.coords[CLUSTER_COORDS.Y] + 1,
                                }}
                            >
                                <EmptyChipRenderer
                                    id={clusterChip.id}
                                    width={width}
                                    height={height}
                                    cores={cores}
                                    dram={dram}
                                    eth={eth}
                                    pcie={pcie}
                                    showActiveTransfers={showActiveTransfers}
                                    selectedZoneAddress={selectedZoneAddress}
                                    isAnnotatingCores={isAnnotatingCores}
                                    TENSIX_SIZE={TENSIX_SIZE}
                                    renderChipId={chips.length > 1}
                                />
                                <div
                                    className='tensix-grid congestion'
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                                        gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
                                    }}
                                >
                                    {transfers.map((transfer, index) => (
                                        <RouteOriginsRenderer
                                            key={`${transfer.id}-${index}`}
                                            transfer={transfer}
                                            clusterChip={clusterChip}
                                            index={index}
                                            getOriginOpacity={getOriginOpacity}
                                        />
                                    ))}
                                    {highlightedTransfer !== null &&
                                        highlightedRoute !== null &&
                                        highlightedTransfer.route[highlightedRoute].device_id === clusterChip.id && (
                                            <RouteOriginsRenderer
                                                key={`${highlightedTransfer.id}-${highlightedRoute}-'route'`}
                                                transfer={highlightedTransfer.route[highlightedRoute]}
                                                clusterChip={clusterChip}
                                                index={highlightedRoute}
                                                getOriginOpacity={getOriginOpacity}
                                            />
                                        )}

                                    {links?.link_demand.map((linkUtilization, index) => {
                                        let fabricCondition = true;
                                        if (fabricEventsFilter === EVENT_TYPE_FILTER.FABRIC_EVENTS) {
                                            fabricCondition =
                                                linkUtilization[NPE_LINK.FABRIC_EVENT_SCOPE] ===
                                                    FABRIC_EVENT_SCOPE_OPTIONS.FABRIC ||
                                                linkUtilization[NPE_LINK.FABRIC_EVENT_SCOPE] ===
                                                    FABRIC_EVENT_SCOPE_OPTIONS.BOTH;
                                        } else if (fabricEventsFilter === EVENT_TYPE_FILTER.LOCAL_EVENTS) {
                                            fabricCondition =
                                                linkUtilization[NPE_LINK.FABRIC_EVENT_SCOPE] ===
                                                    FABRIC_EVENT_SCOPE_OPTIONS.LOCAL ||
                                                linkUtilization[NPE_LINK.FABRIC_EVENT_SCOPE] ===
                                                    FABRIC_EVENT_SCOPE_OPTIONS.BOTH;
                                        }
                                        if (
                                            linkUtilization[NPE_LINK.CHIP_ID] === clusterChip.id &&
                                            (nocFilter === null ||
                                                linkUtilization[NPE_LINK.NOC_ID].indexOf(nocFilter) === 0) &&
                                            fabricCondition
                                        ) {
                                            return (
                                                <button
                                                    type='button'
                                                    key={`${index}-${linkUtilization[NPE_LINK.Y]}-${linkUtilization[NPE_LINK.X]}-${linkUtilization[NPE_LINK.NOC_ID]}`}
                                                    className={`tensix ${linkUtilization[NPE_LINK.Y]}-${linkUtilization[NPE_LINK.X]}`}
                                                    style={{
                                                        position: 'relative',
                                                        gridColumn: linkUtilization[NPE_LINK.X] + 1,
                                                        gridRow: linkUtilization[NPE_LINK.Y] + 1,
                                                    }}
                                                    onClick={() => showActiveTransfers(linkUtilization, index)}
                                                >
                                                    {/* // TENSIX CONGESTION */}
                                                    <TensixTransferRenderer
                                                        key={`${index}-${linkUtilization[NPE_LINK.Y]}-${linkUtilization[NPE_LINK.X]}-${linkUtilization[NPE_LINK.NOC_ID]}-transfers`}
                                                        style={{
                                                            opacity:
                                                                highlightedTransfer !== null ||
                                                                selectedTransferList.length !== 0
                                                                    ? 0.15
                                                                    : 1,
                                                        }}
                                                        width={SVG_SIZE}
                                                        height={SVG_SIZE}
                                                        data={[
                                                            getLinkPoints(
                                                                linkUtilization[NPE_LINK.NOC_ID],
                                                                visualizationMode === VISUALIZATION_MODE.CONGESTION
                                                                    ? calculateLinkCongestionColor(
                                                                          linkUtilization[NPE_LINK.DEMAND],
                                                                          0,
                                                                          altCongestionColors,
                                                                      )
                                                                    : calculateFabricColor(
                                                                          linkUtilization[NPE_LINK.FABRIC_EVENT_SCOPE],
                                                                      ),
                                                            ),
                                                        ]}
                                                        isMulticolor={false}
                                                    />
                                                    <div
                                                        style={{
                                                            fontSize: '9px',
                                                            position: 'absolute',
                                                            top: 0,
                                                            opacity: 1,
                                                        }}
                                                    >
                                                        {linkUtilization[NPE_LINK.Y]}-{linkUtilization[NPE_LINK.X]}
                                                    </div>
                                                </button>
                                            );
                                        }
                                        return null;
                                    })}
                                </div>

                                <div
                                    className='tensix-grid transfers'
                                    style={{
                                        gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                                        gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
                                    }}
                                >
                                    {transferListSelectionRendering.get(clusterChip.id)?.map((row, rowIndex) => {
                                        return (
                                            <Fragment key={`device-${clusterChip.id}-row-${rowIndex}`}>
                                                {row.map((transfersForNoc, colIndex) => {
                                                    return (
                                                        <div
                                                            key={`selected-transfer-${rowIndex}-${colIndex}`}
                                                            className={
                                                                selectedNode?.coords[NPE_LINK.CHIP_ID] ===
                                                                    clusterChip.id &&
                                                                selectedNode?.coords[NPE_LINK.Y] === rowIndex &&
                                                                selectedNode?.coords[NPE_LINK.X] === colIndex
                                                                    ? 'selected tensix no-click'
                                                                    : 'tensix no-click'
                                                            }
                                                            style={{
                                                                gridColumn: colIndex + 1,
                                                                gridRow: rowIndex + 1,
                                                            }}
                                                        >
                                                            <div className='transfer-render-ctn'>
                                                                {/* TENSIX TRANSFERS */}
                                                                <TensixTransferRenderer
                                                                    style={{
                                                                        ...(highlightedTransfer !== null
                                                                            ? { opacity: 0.25 }
                                                                            : { opacity: 1 }),
                                                                    }}
                                                                    width={SVG_SIZE}
                                                                    height={SVG_SIZE}
                                                                    data={getLines(transfersForNoc)}
                                                                    isMulticolor
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </Fragment>
                                        );
                                    })}
                                </div>
                                {highlightedTransfer !== null && (
                                    <div
                                        className='tensix-grid transfer-single'
                                        style={{
                                            gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                                            gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
                                        }}
                                    >
                                        {highlightedTransfer?.route.map((route, index) =>
                                            route.links.map((link) => {
                                                if (
                                                    link[NPE_LINK.CHIP_ID] === clusterChip.id &&
                                                    (highlightedRoute === null || highlightedRoute === index)
                                                ) {
                                                    return (
                                                        <div
                                                            key={`${link[NPE_LINK.Y]}-${link[NPE_LINK.X]}-${link[NPE_LINK.NOC_ID]}`}
                                                            className='tensix'
                                                            style={{
                                                                position: 'relative',
                                                                gridColumn: link[NPE_LINK.X] + 1,
                                                                gridRow: link[NPE_LINK.Y] + 1,
                                                            }}
                                                        >
                                                            <div className='transfer-render-ctn'>
                                                                {/* HIGHLIGHTED TRANSFER */}
                                                                <TensixTransferRenderer
                                                                    width={SVG_SIZE}
                                                                    height={SVG_SIZE}
                                                                    data={getLines([
                                                                        {
                                                                            transfer: highlightedTransfer.id,
                                                                            nocId: link[NPE_LINK.NOC_ID],
                                                                        },
                                                                    ])}
                                                                    isMulticolor={false}
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }),
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                {isActiveTransferDetailsOpen && <div className='grid-spacer'>&nbsp;</div>}
            </div>

            <ActiveTransferDetails
                isOpen={isActiveTransferDetailsOpen}
                groupedTransfersByNoCID={groupedTransfersByNoCID}
                selectedNode={selectedNode}
                congestionData={links?.link_demand.filter(
                    (route) =>
                        route[NPE_LINK.Y] === selectedNode?.coords[NPE_LINK.Y] &&
                        route[NPE_LINK.X] === selectedNode?.coords[NPE_LINK.X],
                )}
                showActiveTransfers={showActiveTransfers}
                highlightedTransfer={highlightedTransfer}
                setHighlightedTransfer={setHighlightedTransfer}
                highlightedRoute={highlightedRoute}
                setHighlightedRoute={setHighlightedRoute}
                nocType={nocFilter}
            />

            <NPEZoneFilterComponent
                npeData={npeData}
                open={openZonesPanel}
                onClose={() => {
                    setOpenZonesPanel(false);
                }}
                onSelect={(coords: NPE_COORDINATES | null) => {
                    setSelectedZoneAddress(coords);
                }}
                onExpand={(state, proc, address) => {
                    const key = getRootZoneKey(proc, address);
                    setExpandedZoneMap((prev) => ({
                        ...prev,
                        [key]: state,
                    }));
                }}
                onZoneClick={onHandleZoneNavigation}
            />
        </div>
    );
};

export default NPEView;
