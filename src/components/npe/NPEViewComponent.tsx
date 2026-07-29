// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
// @eslint-disable jsx-a11y/mouse-events-have-key-events

import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/NPEComponent.scss';
import 'styles/components/NPEZoneFilterComponent.scss';
import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ButtonGroup, ButtonVariant, Classes, Intent, Size, Slider, Switch } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { Fragment } from 'react/jsx-runtime';
import { useAtom } from 'jotai';
import {
    EVENT_TYPE_FILTER,
    FABRIC_EVENT_SCOPE_OPTIONS,
    FabricEventScopeColors,
    KERNEL_PROCESS,
    LinkUtilization,
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
    TimestepData,
} from '../../model/NPEModel';
import TensixTransferRenderer from './TensixTransferRenderer';
import ChipCongestionCanvas from './ChipCongestionCanvas';
import { NODE_SIZE, getLines, resetRouteColors } from './drawingApi';
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
import createToastNotification from '../../functions/createToastNotification';
import { ToastType } from '../../definitions/ToastType';

interface NPEViewProps {
    npeData: NPEData;
    // #861 windowed loading: when a container drives the selected timestep (to
    // refetch per-step windows), it passes both the controlled value and setter,
    // plus a stable `reportKey` so the per-report reset fires on report switch
    // rather than on every windowed `npeData` refetch.
    selectedTimestep?: number;
    onSelectedTimestepChange?: Dispatch<SetStateAction<number>>;
    reportKey?: string;
    // #861 windowed loading: a stable per-step aggregate array for the timeline
    // heat bar. Windowed mode passes this so the timeline keeps one reference
    // across scrubs (its O(n_timesteps) memo runs once per report); whole-file
    // mode omits it and the timeline falls back to `npeData.timestep_data`.
    timelineData?: TimestepData[];
}

const LABEL_STEP_THRESHOLD = 25;
const RIGHT_MARGIN_OFFSET_PX = 25;
// Shared fallbacks for chips with nothing to draw. A fresh `[]` per render would
// give every idle chip a new prop identity on every scrub, re-running the
// congestion canvas's draw effect across the whole cluster for no visual change —
// the bulk of the cost of stepping between two empty timesteps. #1803.
const NO_LINKS: { linkUtilization: LinkUtilization; index: number }[] = [];
const NO_TRANSFERS: { transfer: NoCTransfer; index: number }[] = [];
// Same hazard on the zone path: `npeData` is a new object per scrub, so a fresh `[]`
// here would churn `zones` → `selectedZoneList` → the timeline's `zoneRanges`, whose
// effect repaints 4 × n_timesteps heat cells. On a 196k-timestep report that is
// ~780k fillRects per scrub — for a report that simply has no zones.
const NO_ZONES: NPERootZone[] = [];
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

const NPEView = ({
    npeData,
    selectedTimestep: controlledTimestep,
    onSelectedTimestepChange,
    reportKey,
    timelineData,
}: NPEViewProps) => {
    const [highlightedTransfer, setHighlightedTransfer] = useState<NoCTransfer | null>(null);
    const [highlightedRoute, setHighlightedRoute] = useState<number | null>(null);
    const [internalTimestep, setInternalTimestep] = useState<number>(0);
    const isTimestepControlled = controlledTimestep !== undefined && onSelectedTimestepChange !== undefined;
    const selectedTimestep = isTimestepControlled ? controlledTimestep : internalTimestep;
    const setSelectedTimestep = isTimestepControlled ? onSelectedTimestepChange : setInternalTimestep;
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
        return npeData.zones || NO_ZONES;
    }, [npeData]);

    const isFabricTransfersFilteringEnabled = useMemo(() => {
        return npeData.noc_transfers.some((tr) => tr.fabric_event_type);
    }, [npeData]);

    useEffect(() => {
        if (!isFabricTransfersFilteringEnabled && fabricEventsFilter !== EVENT_TYPE_FILTER.ALL_EVENTS) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
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

    // Pre-bucket per chip so each chip renders only its own entries instead of the
    // render walking all D link_demand rows / A transfers 8 times (once per chip)
    // and discarding the misses. #1803. A transfer lands in every chip its src or
    // any dst touches, matching what RouteOriginsRenderer draws.
    const linkDemandByChip = useMemo(() => {
        const byChip = new Map<number, { linkUtilization: LinkUtilization; index: number }[]>();
        links?.link_demand.forEach((linkUtilization, index) => {
            const chipId = linkUtilization[NPE_LINK.CHIP_ID];
            const bucket = byChip.get(chipId);
            if (bucket) {
                bucket.push({ linkUtilization, index });
            } else {
                byChip.set(chipId, [{ linkUtilization, index }]);
            }
        });
        return byChip;
    }, [links]);

    const transfersByChip = useMemo(() => {
        const byChip = new Map<number, { transfer: NoCTransfer; index: number }[]>();
        transfers.forEach((transfer, index) => {
            const chipIds = new Set<number>();
            if (transfer.src) {
                chipIds.add(transfer.src[NPE_LINK.CHIP_ID]);
            }
            transfer.dst.forEach((dst) => chipIds.add(dst[NPE_LINK.CHIP_ID]));
            chipIds.forEach((chipId) => {
                const bucket = byChip.get(chipId);
                if (bucket) {
                    bucket.push({ transfer, index });
                } else {
                    byChip.set(chipId, [{ transfer, index }]);
                }
            });
        });
        return byChip;
    }, [transfers]);

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
        if (architecture.arch_name === undefined) {
            createToastNotification(`Unsupported architecture`, npeData.common_info.arch, ToastType.WARNING);
        }
    }, [architecture.arch_name, npeData.common_info.arch]);

    useEffect(() => {
        resetRouteColors();
        if (isShowingAllTransfers) {
            // eslint-disable-next-line react-hooks/immutability
            showAllTransfers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTimestep, isShowingAllTransfers]);

    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect */
        // eslint-disable-next-line react-hooks/immutability
        stopAnimation();
        // In controlled mode the container owns the timestep and resets it on
        // report switch; resetting here would snap every windowed refetch to 0.
        if (!isTimestepControlled) {
            setSelectedTimestep(0);
        }
        setSelectedNode(null);
        setSelectedTransferList([]);
        setHighlightedTransfer(null);
        setHighlightedRoute(null);
        /* eslint-enable react-hooks/set-state-in-effect */
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reportKey ?? npeData]);

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

    // showActiveTransfers re-creates on every scrub/selection (its deps include
    // selectedTimestep + selectedNode); route it through a ref so the click
    // handlers handed to the congestion canvas stay referentially stable. #1803.
    const showActiveTransfersRef = useRef(showActiveTransfers);
    useEffect(() => {
        showActiveTransfersRef.current = showActiveTransfers;
    }, [showActiveTransfers]);
    const handleSelectLink = useCallback((linkUtilization: LinkUtilization, index: number) => {
        showActiveTransfersRef.current(linkUtilization, index);
    }, []);
    // Canvas misses (clicking a cell with no link) mirror the old empty-tile
    // click, which deselected via showActiveTransfers(null).
    const handleClearSelection = useCallback(() => {
        showActiveTransfersRef.current(null);
    }, []);

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

    // The base origin squares are driven entirely by `getOriginOpacity`, which
    // returns 0 for every id-bearing transfer unless one is selected or
    // highlighted. In the common scrub state (nothing selected/highlighted) the
    // whole layer is fully transparent, so rendering it just churns thousands of
    // invisible src/dst divs per scrub. Skip it unless it can actually be seen. #1803.
    const hasVisibleTransferOrigins = selectedTransferList.length > 0 || highlightedTransfer !== null;

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
                            title='Step backward'
                        />
                        <Button
                            icon={isTimelinePlaying ? IconNames.Pause : IconNames.Play}
                            intent={playbackSpeed === PLAYBACK_SPEED ? Intent.PRIMARY : Intent.NONE}
                            onClick={isTimelinePlaying ? onPause : onPlay}
                            title={isTimelinePlaying ? 'Pause' : 'Play'}
                        />
                        <Button
                            icon={IconNames.FastForward}
                            onClick={onPlay2x}
                            intent={playbackSpeed === PLAYBACK_SPEED_2X ? Intent.PRIMARY : Intent.NONE}
                            title='Play 2x speed'
                        />
                        <Button
                            icon={IconNames.StepForward}
                            onClick={onForward}
                            title='Step forward'
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

                        <div>
                            Zoom
                            <Slider
                                handleHtmlProps={{ 'aria-label': 'Zoom' }}
                                min={0.1}
                                max={2}
                                stepSize={0.1}
                                labelStepSize={1}
                                value={zoom}
                                onChange={(value: number) => setZoom(value)}
                                labelRenderer={(value) => `${value.toFixed(1)}`}
                            />
                        </div>
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
                        className={classNames(Classes.SLIDER_PROGRESS, 'duplicate')}
                        style={{ width: `${canvasWidth - RIGHT_MARGIN_OFFSET_PX}px` }}
                    />
                </div>
                <NPETimelineComponent
                    timestepList={timelineData ?? npeData.timestep_data}
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
                                    showActiveTransfers={handleClearSelection}
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
                                    {hasVisibleTransferOrigins &&
                                        (transfersByChip.get(clusterChip.id) ?? NO_TRANSFERS).map(
                                            ({ transfer, index }) => (
                                                <RouteOriginsRenderer
                                                    key={`${transfer.id}-${index}`}
                                                    transfer={transfer}
                                                    clusterChip={clusterChip}
                                                    index={index}
                                                    getOriginOpacity={getOriginOpacity}
                                                />
                                            ),
                                        )}
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

                                    <ChipCongestionCanvas
                                        links={linkDemandByChip.get(clusterChip.id) ?? NO_LINKS}
                                        gridWidth={width}
                                        gridHeight={height}
                                        isFabricMode={visualizationMode === VISUALIZATION_MODE.TRANSFERS}
                                        altCongestionColors={altCongestionColors}
                                        nocFilter={nocFilter}
                                        fabricEventsFilter={fabricEventsFilter}
                                        dimmed={highlightedTransfer !== null || selectedTransferList.length !== 0}
                                        zoom={zoom}
                                        onSelectLink={handleSelectLink}
                                        onClearSelection={handleClearSelection}
                                    />
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
