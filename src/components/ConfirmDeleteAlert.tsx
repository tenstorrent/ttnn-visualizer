// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Alert, Intent } from '@blueprintjs/core';
import { ReactNode } from 'react';
import { DeletableEntity } from '../definitions/DeletableEntity';

interface ConfirmDeleteAlertProps {
    isOpen: boolean;
    entity: DeletableEntity;
    entityName: string;
    onConfirm: () => void;
    onCancel: () => void;
    /** Extra consequences of deleting, rendered under the default sentence. */
    children?: ReactNode;
}

/**
 * Mount this beside a Select rather than inside its itemRenderer — the popover closes when the
 * alert takes focus, which would unmount an alert owned by a row.
 */
const ConfirmDeleteAlert = ({ isOpen, entity, entityName, onConfirm, onCancel, children }: ConfirmDeleteAlertProps) => (
    <Alert
        canEscapeKeyCancel
        canOutsideClickCancel
        isOpen={isOpen}
        intent={Intent.DANGER}
        onCancel={onCancel}
        onClose={onCancel}
        onConfirm={onConfirm}
        cancelButtonText='Cancel'
        confirmButtonText='Delete'
        // @ts-expect-error backdropClassName is not defined in AlertProps
        backdropClassName='confirm-delete-backdrop'
    >
        <p>
            Are you sure you want to delete the {entity} <strong>{entityName}</strong>? This action cannot be undone.
        </p>
        {children}
    </Alert>
);

export default ConfirmDeleteAlert;
