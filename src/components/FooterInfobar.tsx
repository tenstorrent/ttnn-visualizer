import classNames from 'classnames';
import { Button, Collapse, Icon, NumberRange, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router';
import {
    activePerformanceTraceAtom,
    activeReportAtom,
    operationRangeAtom,
    performanceRangeAtom,
    selectedRangeAtom,
} from '../store/app';
import { useGetDeviceOperationListPerf } from '../hooks/useAPI';
import Range from './RangeSlider';
import ROUTES from '../definitions/Routes';

const MAX_TITLE_LENGTH = 20;

function FooterInfobar() {
    const [sliderIsOpen, setSliderIsOpen] = useState(true);
    const selectedRange = useAtomValue(selectedRangeAtom);
    const operationRange = useAtomValue(operationRangeAtom);
    const performanceRange = useAtomValue(performanceRangeAtom);
    const activeReport = useAtomValue(activeReportAtom);
    const activePerformanceTrace = useAtomValue(activePerformanceTraceAtom);
    const location = useLocation();

    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();

    const isInSync = useGetDeviceOperationListPerfResult.length > 0;
    const isOperationDetails = location.pathname.includes(`${ROUTES.OPERATIONS}/`);

    useEffect(() => {
        if (isOperationDetails) {
            setSliderIsOpen(false);
        }
    }, [isOperationDetails]);

    return (
        <footer className='app-footer'>
            <div className='current-data'>
                <div className='active-reports'>
                    {activeReport &&
                        (activeReport.length > MAX_TITLE_LENGTH ? (
                            <Tooltip
                                content={activeReport}
                                className={classNames('title', {
                                    'is-lengthy': activeReport.length > MAX_TITLE_LENGTH,
                                })}
                            >
                                <span>
                                    <strong>Report:</strong> {activeReport}
                                </span>
                            </Tooltip>
                        ) : (
                            <span>
                                <strong>Report:</strong> {activeReport}
                            </span>
                        ))}

                    {activePerformanceTrace &&
                        (activePerformanceTrace.length > MAX_TITLE_LENGTH ? (
                            <Tooltip
                                content={activePerformanceTrace}
                                className={classNames('title', {
                                    'is-lengthy': activePerformanceTrace.length > MAX_TITLE_LENGTH,
                                })}
                            >
                                <span>
                                    <strong>Performance:</strong> {activePerformanceTrace}
                                </span>
                            </Tooltip>
                        ) : (
                            <span>
                                <strong>Performance:</strong> {activePerformanceTrace}
                            </span>
                        ))}
                    {activeReport && activePerformanceTrace && (
                        <span>
                            {isInSync ? (
                                <strong>
                                    <Icon
                                        icon={IconNames.TickCircle}
                                        className='intent-ok'
                                    />{' '}
                                    Profiler and perf reports synchronised
                                </strong>
                            ) : (
                                <strong>
                                    <Icon
                                        icon={IconNames.ISSUE}
                                        className='intent-not-ok'
                                    />{' '}
                                    Profiler and perf reports can&apos;t be synchronized
                                </strong>
                            )}
                        </span>
                    )}
                </div>

                {(operationRange || performanceRange) && (
                    <div className='slider-controls'>
                        {!sliderIsOpen && !hasRangeSelected(selectedRange, operationRange) && (
                            <span className='current-range'>
                                Selected: {selectedRange && `${selectedRange[0]} - ${selectedRange[1]}`}
                            </span>
                        )}
                        <Button
                            icon={sliderIsOpen ? IconNames.CARET_DOWN : IconNames.CARET_UP}
                            onClick={() => setSliderIsOpen(!sliderIsOpen)}
                            small
                            disabled={isOperationDetails}
                        >
                            Range
                        </Button>
                    </div>
                )}
            </div>

            <Collapse
                isOpen={sliderIsOpen}
                keepChildrenMounted
            >
                <Range />
            </Collapse>
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
