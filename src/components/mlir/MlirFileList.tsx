// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import classNames from 'classnames';
import { Icon, Menu, MenuItem, Spinner } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { MlirFileResult } from '../../model/MLIRJsonModel';
import 'styles/components/MlirFileList.scss';

interface MlirFileListProps {
    results: MlirFileResult[];
    className?: string;
    selectedIndex?: number | null;
    // When provided the list is selectable: successfully-converted rows become
    // clickable. Omit it for a read-only list (e.g. the in-progress spinner
    // view shown while files are still being converted).
    onSelect?: (index: number) => void;
}

// Shared row list for the per-file outcome of an MLIR upload/load. Used both
// while files are still converting (PROGRESS rows render a spinner) and for the
// final picker, so the in-progress and settled views are visually identical.
const MlirFileList = ({ results, className, selectedIndex = null, onSelect }: MlirFileListProps) => (
    <Menu className={classNames('mlir-file-list', className)}>
        {results.map((result, index) => {
            const isPending = result.status === ConnectionTestStates.PROGRESS;
            const isSuccess = result.status === ConnectionTestStates.OK && !!result.graph;
            const selectable = !!onSelect && isSuccess;
            const isSelected = !!onSelect && index === selectedIndex;

            // Right-hand element: a spinner while the file is still converting,
            // otherwise the outcome text, colourised via class by its status.
            const labelElement = isPending ? (
                <Spinner size={16} />
            ) : (
                <span className={classNames('mlir-file-status', { 'is-success': isSuccess, 'is-failed': !isSuccess })}>
                    {result.message ?? (isSuccess ? 'Uploaded' : 'Failed')}
                </span>
            );

            return (
                <MenuItem
                    key={`${result.filename}-${result.name ?? index}`}
                    // The leading eye marks the row as viewable: muted grey in
                    // every state, turning green only on the selected row.
                    icon={
                        <Icon
                            icon={IconNames.EYE_OPEN}
                            className={classNames('mlir-file-eye', { 'is-selected': isSelected })}
                        />
                    }
                    text={result.filename}
                    labelElement={labelElement}
                    disabled={!selectable}
                    active={isSelected}
                    onClick={onSelect ? () => onSelect(index) : undefined}
                    roleStructure='listoption'
                />
            );
        })}
    </Menu>
);

export default MlirFileList;
