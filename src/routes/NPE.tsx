// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/* eslint-disable no-nested-ternary */
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { Button, ButtonVariant, MenuItem } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ItemRenderer, Select } from '@blueprintjs/select';
import NPEFileLoader from '../components/npe/NPEFileLoader';
import NPEView from '../components/npe/NPEViewComponent';
import { useNpe } from '../hooks/useAPI';
import { activeNpeOpTraceAtom } from '../store/app';
import { NPEData } from '../model/NPEModel';
import LoadingSpinner from '../components/LoadingSpinner';
import { semverParse } from '../functions/semverParse';
import npeDemoDataSinglechip from '../assets/data/npe-demo-single.json';
import npeDemoDataMultichip from '../assets/data/npe-demo-multi.json';
import getServerConfig from '../functions/getServerConfig';

const NPE_DATA_VERSION = '1.0.0';

const NPE_REPO_URL = (
    <a
        target='_blank'
        href='https://github.com/tenstorrent/tt-npe'
        rel='noreferrer'
    >
        tt-npe
    </a>
);

enum NPEDemo {
    SINGLE_CHIP = 'singlechip',
    MULTI_CHIP = 'multichip',
}

interface NPEDemoData {
    reportFile: NPEDemo;
    label: string;
    data: NPEData;
}

const NPE_DEMO_DATA: NPEDemoData[] = [
    {
        reportFile: NPEDemo.SINGLE_CHIP,
        data: npeDemoDataSinglechip as unknown as NPEData,
        label: 'NPE single chip demo',
    },
    {
        reportFile: NPEDemo.MULTI_CHIP,
        data: npeDemoDataMultichip as unknown as NPEData,
        label: 'NPE multichip demo',
    },
];

const NPE: React.FC = () => {
    const npeFileName = useAtomValue(activeNpeOpTraceAtom);
    const { data: loadedData, isLoading } = useNpe(npeFileName);
    const [demoData, setDemoData] = useState<NPEData | null>(null);
    const [selectedDemo, setSelectedDemo] = useState<NPEDemoData | null>(null);

    const renderItem: ItemRenderer<NPEDemoData> = (item: NPEDemoData, { handleClick, modifiers }) => {
        return (
            <MenuItem
                key={item.reportFile}
                textClassName='folder-picker-label'
                text={item.label}
                labelClassName='folder-picker-name-label'
                active={item.reportFile === selectedDemo?.reportFile}
                roleStructure='listoption'
                disabled={modifiers.disabled}
                onClick={handleClick}
                icon={IconNames.SAVED}
            />
        );
    };
    const npeData = demoData || loadedData;
    const isDemoEnabled = getServerConfig()?.SERVER_MODE;
    useEffect(() => {
        if (loadedData) {
            setSelectedDemo(null);
            setDemoData(null);
        }
    }, [loadedData]);
    return (
        <>
            <Helmet title='NPE' />

            <h1 className='page-title'>NOC performance estimator</h1>
            <div className='npe-inline-loaders'>
                <NPEFileLoader />
                {isDemoEnabled && (
                    <>
                        <Select
                            className=''
                            items={NPE_DEMO_DATA}
                            itemRenderer={renderItem}
                            noResults={
                                <MenuItem
                                    disabled
                                    text='No results.'
                                    roleStructure='listoption'
                                />
                            }
                            onItemSelect={(item) => {
                                const { data } = item;
                                setSelectedDemo(item);
                                setDemoData(data);
                            }}
                        >
                            {selectedDemo ? (
                                <Button
                                    className='folder-picker-button'
                                    text={selectedDemo.label}
                                    alignText='start'
                                    icon={IconNames.SAVED}
                                    endIcon={IconNames.CARET_DOWN}
                                    variant={ButtonVariant.OUTLINED}
                                />
                            ) : (
                                <Button
                                    className='folder-picker-button'
                                    text='Select a demo NPE report'
                                    alignText='start'
                                    icon={IconNames.DOCUMENT_OPEN}
                                    endIcon={IconNames.CARET_DOWN}
                                    variant={ButtonVariant.OUTLINED}
                                />
                            )}
                        </Select>

                        <br />
                    </>
                )}
            </div>
            {isLoading ? (
                <LoadingSpinner />
            ) : npeData ? (
                isValidNpeData(npeData) ? (
                    <NPEView npeData={npeData} />
                ) : (
                    <>
                        <p>
                            Invalid NPE data or version. Current supported version is {NPE_DATA_VERSION} got&nbsp;
                            {npeData.common_info.version || 'null'};
                        </p>

                        {/* TODO: Reorganise this so we're not duplicating matchNpeDataVersion */}
                        <p>
                            Use {NPE_REPO_URL} to generate new NPE dataset
                            {matchNpeDataVersion(npeData.common_info.version) ? (
                                <> or install an older version of the visualizer </>
                            ) : null}
                        </p>

                        {matchNpeDataVersion(npeData.common_info.version) ? (
                            <pre>pip install ttnn-visualizer=={matchNpeDataVersion(npeData.common_info.version)}</pre>
                        ) : null}
                    </>
                )
            ) : (
                <p>See {NPE_REPO_URL} for details on how to generate NPE report files.</p>
            )}
        </>
    );
};

// This should be done server side
const isValidNpeData = (data: NPEData): boolean => {
    const requiredKeys: (keyof NPEData)[] = ['common_info', 'noc_transfers', 'timestep_data'];
    const hasAllKeys = requiredKeys.every((key) => key in data);

    if (!hasAllKeys) {
        return false;
    }
    const version = semverParse(data.common_info.version);
    if (!version) {
        return false;
    }
    const expectedVersion = semverParse(NPE_DATA_VERSION);

    if (version?.major !== expectedVersion?.major) {
        return false;
    }

    return true;
};

const matchNpeDataVersion = (version: string) => {
    const parsedVersion = semverParse(version);
    switch (parsedVersion) {
        case null:
        case undefined:
            return '0.32.3';
        default:
            return '';
    }
};

export default NPE;
