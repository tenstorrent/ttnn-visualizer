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
    // Ordered selection (1st = primary/left, 2nd = comparison/right). Empty when
    // nothing is selected. Omit with onSelect for a read-only list.
    selectedIndices?: number[];
    // When true, unselected success rows are not clickable (selection is at cap).
    selectionLimitReached?: boolean;
    retryingIndices?: Set<number>;
    // When provided the list is selectable: successfully-converted rows become
    // clickable. Omit it for a read-only list (e.g. the in-progress spinner
    // view shown while files are still being converted).
    onSelect?: (index: number) => void;
    onRetry?: (index: number) => void;
    canRetry?: (index: number) => boolean;
}

// Shared row list for the per-file outcome of an MLIR upload/load. Used both
// while files are still converting (PROGRESS rows render a spinner) and for the
// final picker, so the in-progress and settled views are visually identical.
const MlirFileList = ({
    results,
    className,
    selectedIndices = [],
    selectionLimitReached = false,
    retryingIndices = new Set<number>(),
    onSelect,
    onRetry,
    canRetry,
}: MlirFileListProps) => (
    <Menu
        className={classNames('mlir-file-list', className)}
        aria-multiselectable={onSelect ? true : undefined}
        aria-label={onSelect ? 'MLIR upload results' : undefined}
    >
        {results.map((result, index) => {
            const isPending = result.status === ConnectionTestStates.PROGRESS;
            const isSuccess = result.status === ConnectionTestStates.OK && !!result.graph;
            const isFailedServerFile = result.status === ConnectionTestStates.FAILED && result.persisted;
            const shouldShowEyeIcon = !isPending && result.status !== ConnectionTestStates.FAILED;
            const isSelected = !!onSelect && selectedIndices.includes(index);
            // At the selection cap, already-selected rows stay clickable so the
            // user can deselect; others must look and behave disabled.
            const selectable = !!onSelect && isSuccess && (isSelected || !selectionLimitReached);
            const retryAvailable = canRetry ? canRetry(index) : true;
            const hasRetryAction = isFailedServerFile && !!onRetry && retryAvailable;
            const retryInFlight = retryingIndices.has(index);

            // Right-hand element: shows Processing during conversion/retry,
            // failed rows include Retry when context exists, else status text.
            let labelElement;
            if (isPending) {
                labelElement = <span className='mlir-file-status'>Processing</span>;
            } else if (hasRetryAction && onRetry) {
                labelElement = (
                    <div className='mlir-file-failure-controls'>
                        <span className='mlir-file-status is-failed'>{result.message ?? 'Failed'}</span>
                        <Button
                            variant={ButtonVariant.MINIMAL}
                            icon={IconNames.REFRESH}
                            disabled={retryInFlight}
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
                    icon={leadingElement}
                    text={result.filename}
                    labelElement={labelElement}
                    disabled={!selectable && !hasRetryAction}
                    active={isSelected}
                    aria-selected={onSelect ? isSelected : undefined}
                    onClick={selectable && onSelect ? () => onSelect(index) : undefined}
                    roleStructure='listoption'
                />
            );
        })}
    </Menu>
);

export default MlirFileList;
