// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Theme, ToastPosition, toast } from 'react-toastify';
import ToastFileChange from '../components/ToastFileChange';

export default function createToastNotification(message: string, fileName: string, isError?: boolean) {
    const template = (
        <ToastFileChange
            message={message}
            fileName={fileName}
        />
    );
    const args = {
        position: 'bottom-right' as ToastPosition,
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: false,
        draggable: true,
        progress: undefined,
        theme: 'light' as Theme,
    };

    if (isError) {
        toast.error(template, args);
    } else {
        toast(template, args);
    }
}
