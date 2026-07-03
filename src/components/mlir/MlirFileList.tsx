// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Menu, MenuItem, Spinner } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { MlirFileResult } from '../../model/MLIRJsonModel';
import 'styles/components/MlirFileList.scss';

interface MlirFileListProps {
    results: MlirFileResult[];
    className?: string;
    selectedIndex?: number | null;
    retryingIndex?: number | null;
    // When provided the list is selectable: successfully-converted rows become
    // clickable. Omit it for a read-only list (e.g. the in-progress spinner
    // view shown while files are still being converted).
    onSelect?: (index: number) => void;
    onRetry?: (index: number) => void;
}

// Shared row list for the per-file outcome of an MLIR upload/load. Used both
// while files are still converting (PROGRESS rows render a spinner) and for the
// final picker, so the in-progress and settled views are visually identical.
const MlirFileList = ({
    results,
    className,
    selectedIndex = null,
    retryingIndex = null,
    onSelect,
    onRetry,
}: MlirFileListProps) => (
    <Menu className={classNames('mlir-file-list', className)}>
        {results.map((result, index) => {
            const isPending = result.status === ConnectionTestStates.PROGRESS;
            const isSuccess = result.status === ConnectionTestStates.OK && !!result.graph;
            const isFailedServerFile = result.status === ConnectionTestStates.FAILED && result.persisted;
            const shouldShowEyeIcon = !isPending && result.status !== ConnectionTestStates.FAILED;
            const selectable = !!onSelect && isSuccess;
            const hasRetryAction = isFailedServerFile && !!onRetry;
            const isSelected = !!onSelect && index === selectedIndex;
            const isRetrying = retryingIndex === index;

            // Right-hand element: a spinner while the file is still converting,
            // otherwise the outcome text, colourised via class by its status.
            let labelElement;
            if (isPending) {
                labelElement = <span className='mlir-file-status'>Processing</span>;
            } else if (isFailedServerFile && onRetry) {
                labelElement = (
                    <div className='mlir-file-failure-controls'>
                        <span className='mlir-file-status is-failed'>{result.message ?? 'Failed'}</span>
                        <Button
                            variant={ButtonVariant.MINIMAL}
                            icon={IconNames.REFRESH}
                            disabled={isRetrying}
                            loading={isRetrying}
                            onClick={(event) => {
                                event.stopPropagation();
                                onRetry(index);
                            }}
                        >
                            Retry
                        </Button>
                    </div>
                );
            } else {
                labelElement = (
                    <span
                        className={classNames('mlir-file-status', {
                            'is-success': isSuccess,
                            'is-failed': !isSuccess,
                        })}
                    >
                        {result.message ?? (isSuccess ? 'Uploaded' : 'Failed')}
                    </span>
                );
            }

            let leadingElement;
            if (isPending) {
                leadingElement = <Spinner size={16} />;
            } else if (shouldShowEyeIcon) {
                leadingElement = (
                    <Icon
                        icon={IconNames.EYE_OPEN}
                        className={classNames('mlir-file-icon', { 'is-selected': isSelected })}
                    />
                );
            } else {
                leadingElement = <span className='mlir-file-icon' />;
            }

            return (
                <MenuItem
                    className='mlir-file-list-item'
                    key={`${result.filename}-${result.name ?? index}`}
                    // The leading eye marks the row as viewable: muted grey in
                    // every state, turning green only on the selected row.
                    icon={leadingElement}
                    text={result.filename}
                    labelElement={labelElement}
                    disabled={!selectable && !hasRetryAction}
                    active={isSelected}
                    onClick={selectable && onSelect ? () => onSelect(index) : undefined}
                    roleStructure='listoption'
                />
            );
        })}
    </Menu>
);

export default MlirFileList;
