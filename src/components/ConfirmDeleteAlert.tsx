// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Alert, Intent } from '@blueprintjs/core';
import { ReactNode } from 'react';
import { CANCEL_DELETE_LABEL, CONFIRM_DELETE_LABEL, ManagedEntity } from '../definitions/ManagedEntity';

interface ConfirmDeleteAlertProps {
    isOpen: boolean;
    entity: ManagedEntity;
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
        // No onClose: Alert calls it after onCancel/onConfirm alike, so wiring it to onCancel would
        // run the cancel path on confirm too. Escape and outside clicks already route to onCancel.
        onCancel={onCancel}
        onConfirm={onConfirm}
        cancelButtonText={CANCEL_DELETE_LABEL}
        confirmButtonText={CONFIRM_DELETE_LABEL}
        // Alert collects the props it doesn't recognise and spreads them onto its Dialog, which
        // does accept backdropClassName; only AlertProps omits it from the public type.
        // @ts-expect-error backdropClassName is not declared on AlertProps
        backdropClassName='confirm-delete-backdrop'
    >
        <p>
            Are you sure you want to delete the {entity} <strong>{entityName}</strong>? This action cannot be undone.
        </p>
        {children}
    </Alert>
);

export default ConfirmDeleteAlert;
