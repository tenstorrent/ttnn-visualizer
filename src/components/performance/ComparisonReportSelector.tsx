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
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';

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
    const [comparisonReports, setComparisonReports] = useAtom(comparisonPerformanceReportAtom);
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
                        const selectedReports = (comparisonReports || []).filter(
                            (_reportName, index) => index !== reportIndex,
                        );

                        return (
                            folder.reportName !== activePerformanceReport &&
                            !selectedReports.includes(folder.reportName)
                        );
                    })}
                    value={comparisonReports?.[reportIndex] || null}
                    handleSelect={(folder: ReportFolder) => {
                        const updatedReports = [...(comparisonReports || [])];
                        updatedReports[reportIndex] = folder.reportName;

                        setComparisonReports(updatedReports);
                    }}
                />

                <Button
                    variant={ButtonVariant.OUTLINED}
                    icon={IconNames.CROSS}
                    onClick={() => {
                        const updatedReports = [...(comparisonReports || [])];
                        updatedReports.splice(reportIndex, 1);

                        setComparisonReports(updatedReports?.length === 0 ? null : updatedReports);
                    }}
                    disabled={!comparisonReports?.[reportIndex]}
                />
            </div>
        </FormGroup>
    );
};

export default ComparisonReportSelector;
