// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TEST_IDS } from '../definitions/TestIds';

interface ToastFileChangeProps {
    message: string;
    fileName: string;
}

const ToastFileChange = ({ message, fileName }: ToastFileChangeProps) => {
    return (
        <div>
            {message}
            <br />
            <strong data-testid={TEST_IDS.TOAST_FILENAME}>{fileName}</strong>
        </div>
    );
};

export default ToastFileChange;
