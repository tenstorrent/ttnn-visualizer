// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { toast } from 'react-toastify';
import ToastFileChange from '../components/ToastFileChange';

export default function createToastNotification(message: string, fileName: string) {
    toast(
        <ToastFileChange
            message={message}
            fileName={fileName}
        />,
        {
            position: 'bottom-right',
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: false,
            draggable: true,
            progress: undefined,
            theme: 'light',
        },
    );
}
