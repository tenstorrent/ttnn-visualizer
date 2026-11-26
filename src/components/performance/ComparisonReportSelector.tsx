// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, FormGroup } from '@blueprintjs/core';
import { useAtom, useAtomValue } from 'jotai';
import React from 'react';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import LocalFolderPicker from '../report-selection/LocalFolderPicker';
import { ReportFolder } from '../../definitions/Reports';
import { activePerformanceReportFolderNameAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import { formatSyncedReportName } from '../../functions/reportRank';
import { getFolderReportId } from '../../functions/reportLinks';
import { recordPerfComparisonUsed } from '../../functions/surfaceEvents';
import { TEST_IDS } from '../../definitions/TestIds';

interface ComparisonReportSelectorProps {
    folderList: ReportFolder[];
    reportIndex: number;
    label?: React.ReactNode;
    subLabel?: string;
    className?: string;
}

const ComparisonReportSelector = ({
    folderList,
    reportIndex,
    label,
    subLabel,
    className,
}: ComparisonReportSelectorProps) => {
    const [comparisonReportList, setComparisonReportList] = useAtom(comparisonPerformanceReportListAtom);
    const activeReportId = useAtomValue(activePerformanceReportFolderNameAtom);
    const selectedReportId = comparisonReportList?.[reportIndex] || null;
    // The reports chosen in the other selectors, so one report cannot fill two slots.
    const otherSelectedReports = (comparisonReportList || []).filter((_reportId, index) => index !== reportIndex);

    return (
        <FormGroup
            className={classNames('form-group', className)}
            label={label}
            subLabel={subLabel}
            data-testid={TEST_IDS.COMPARISON_REPORT_SELECTOR}
        >
            <div className='folder-selection'>
                <LocalFolderPicker
                    items={folderList.filter((folder: ReportFolder) => {
                        const reportId = getFolderReportId(folder);

                        return (
                            reportId !== null && reportId !== activeReportId && !otherSelectedReports.includes(reportId)
                        );
                    })}
                    // The picker marks the row whose `path` equals `value`. A listing row's `path`
                    // is its folder name, which is the id stored here.
                    value={selectedReportId}
                    valueLabel={selectedReportId ? formatSyncedReportName(selectedReportId) : null}
                    handleSelect={(folder: ReportFolder) => {
                        const reportId = getFolderReportId(folder);

                        if (reportId === null) {
                            return;
                        }

                        const isSameReport = comparisonReportList?.[reportIndex] === reportId;
                        const updatedReports = [...(comparisonReportList || [])];
                        updatedReports[reportIndex] = reportId;

                        setComparisonReportList(updatedReports);

                        // Re-picking the report already in this slot changes nothing. The list
                        // has no gaps: the only empty slot is the one after the last report, and
                        // removing a report closes its slot up.
                        if (!isSameReport) {
                            recordPerfComparisonUsed(updatedReports.length);
                        }
                    }}
                />

                <Button
                    variant={ButtonVariant.OUTLINED}
                    icon={IconNames.CROSS}
                    onClick={() => {
                        const updatedReports = [...(comparisonReportList || [])];
                        updatedReports.splice(reportIndex, 1);

                        setComparisonReportList(updatedReports?.length === 0 ? null : updatedReports);
                    }}
                    disabled={!selectedReportId}
                    aria-label={selectedReportId ? `Remove report` : 'No report selected'}
                />
            </div>
        </FormGroup>
    );
};

export default ComparisonReportSelector;
