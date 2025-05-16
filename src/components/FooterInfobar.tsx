// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import classNames from 'classnames';
import { Button, Collapse, NumberRange, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    operationRangeAtom,
    performanceRangeAtom,
    selectedOperationRangeAtom,
} from '../store/app';
import SyncStatus from './SyncStatus';
import Range from './RangeSlider';
import ROUTES from '../definitions/Routes';
import 'styles/components/FooterInfobar.scss';

const MAX_TITLE_LENGTH = 20;

function FooterInfobar() {
    const [sliderIsOpen, setSliderIsOpen] = useState(false);
    const selectedRange = useAtomValue(selectedOperationRangeAtom);
    const operationRange = useAtomValue(operationRangeAtom);
    const performanceRange = useAtomValue(performanceRangeAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const location = useLocation();

    const isOperationDetails = location.pathname.includes(`${ROUTES.OPERATIONS}/`);
    const isPerformanceRoute = location.pathname === ROUTES.PERFORMANCE;
    const isNPE = location.pathname.includes(`${ROUTES.NPE}`);

    useEffect(() => {
        if (isOperationDetails || isNPE) {
            setSliderIsOpen(false);
        }
    }, [isNPE, isOperationDetails]);

    const getSelectedRangeLabel = (): string | null => {
        if (isPerformanceRoute) {
            return performanceRange && `Selected Performance:  ${performanceRange[0]} - ${performanceRange[1]}`;
        }

        return selectedRange && `Selected: ${selectedRange[0]} - ${selectedRange[1]}`;
    };

    return (
        <footer className={classNames('app-footer', { 'is-open': sliderIsOpen })}>
            <div className='current-data'>
                <div className='active-reports'>
                    {activeProfilerReport &&
                        (activeProfilerReport.length > MAX_TITLE_LENGTH ? (
                            <Tooltip
                                content={activeProfilerReport}
                                className={classNames('title', {
                                    'is-lengthy': activeProfilerReport.length > MAX_TITLE_LENGTH,
                                })}
                            >
                                <span>
                                    <strong>Report:</strong> {activeProfilerReport}
                                </span>
                            </Tooltip>
                        ) : (
                            <span>
                                <strong>Report:</strong> {activeProfilerReport}
                            </span>
                        ))}

                    {activePerformanceReport &&
                        (activePerformanceReport.length > MAX_TITLE_LENGTH ? (
                            <Tooltip
                                content={activePerformanceReport}
                                className={classNames('title', {
                                    'is-lengthy': activePerformanceReport.length > MAX_TITLE_LENGTH,
                                })}
                            >
                                <span>
                                    <strong>Performance:</strong> {activePerformanceReport}
                                </span>
                            </Tooltip>
                        ) : (
                            <span>
                                <strong>Performance:</strong> {activePerformanceReport}
                            </span>
                        ))}
                    {activeProfilerReport && activePerformanceReport && <SyncStatus />}
                </div>

                {(operationRange || performanceRange) && (
                    <div className='slider-controls'>
                        {!sliderIsOpen && !hasRangeSelected(selectedRange, operationRange) && (
                            <span className='current-range'>{getSelectedRangeLabel()}</span>
                        )}

                        <Button
                            icon={sliderIsOpen ? IconNames.CARET_DOWN : IconNames.CARET_UP}
                            onClick={() => setSliderIsOpen(!sliderIsOpen)}
                            disabled={isOperationDetails}
                            size='small'
                        >
                            Range
                        </Button>
                    </div>
                )}
            </div>

            {(activeProfilerReport || activePerformanceReport) && (
                <Collapse
                    className='slider-container'
                    isOpen={sliderIsOpen}
                    keepChildrenMounted
                >
                    <Range />
                </Collapse>
            )}
        </footer>
    );
}

const hasRangeSelected = (selectedRange: NumberRange | null, operationRange: NumberRange | null): boolean =>
    !!(
        selectedRange &&
        operationRange &&
        selectedRange[0] === operationRange[0] &&
        selectedRange[1] === operationRange[1]
    );

export default FooterInfobar;
