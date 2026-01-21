// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ToastOptions, toast } from 'react-toastify';
import ToastFileChange from '../components/ToastFileChange';

export enum ToastType {
    INFO = 'info',
    SUCCESS = 'success',
    WARNING = 'warning',
    ERROR = 'error',
}

export default function createToastNotification(message: string, fileName: string, type?: ToastType) {
    const template = (
        <ToastFileChange
            message={message}
            fileName={fileName}
        />
    );

    // Moved args to the ToastContainer level but keeping this here in the short term in case we need to restore any (e.g. because bugs)
    const args: ToastOptions = {};

    if (type) {
        toast[type](template, args);
    } else {
        toast(template, args);
    }
}
