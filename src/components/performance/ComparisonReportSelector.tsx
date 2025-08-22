// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, FormGroup } from '@blueprintjs/core';
import { useAtom, useAtomValue } from 'jotai';
import React, { FC } from 'react';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import LocalFolderPicker from '../report-selection/LocalFolderPicker';
import { ReportFolder } from '../../definitions/Reports';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';

interface ComparisonReportSelectorProps {
    folderList: ReportFolder[];
    reportIndex: number;
    label?: React.ReactNode;
    subLabel?: string;
    className?: string;
}

const ComparisonReportSelector: FC<ComparisonReportSelectorProps> = ({
    folderList,
    reportIndex,
    label,
    subLabel,
    className,
}) => {
    const [comparisonReportList, setComparisonReportList] = useAtom(comparisonPerformanceReportListAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    return (
        <FormGroup
            className={classNames('form-group', className)}
            label={label}
            subLabel={subLabel}
            data-testid='comparison-report-selector'
        >
            <div className='folder-selection'>
                <LocalFolderPicker
                    items={folderList.filter((folder: ReportFolder) => {
                        const selectedReports = (comparisonReportList || []).filter(
                            (_reportName, index) => index !== reportIndex,
                        );

                        return (
                            folder.reportName !== activePerformanceReport &&
                            !selectedReports.includes(folder.reportName)
                        );
                    })}
                    value={comparisonReportList?.[reportIndex] || null}
                    handleSelect={(folder: ReportFolder) => {
                        const updatedReports = [...(comparisonReportList || [])];
                        updatedReports[reportIndex] = folder.reportName;

                        setComparisonReportList(updatedReports);
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
                    disabled={!comparisonReportList?.[reportIndex]}
                    aria-label={!comparisonReportList?.[reportIndex] ? `Remove report` : 'No report selected'}
                />
            </div>
        </FormGroup>
    );
};

export default ComparisonReportSelector;
