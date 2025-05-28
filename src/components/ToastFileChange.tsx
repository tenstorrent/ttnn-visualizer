// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

interface ToastFileChangeProps {
    message: string;
    fileName: string;
}

const ToastFileChange = ({ message, fileName }: ToastFileChangeProps) => {
    return (
        <div>
            {message}
            <br />
            <strong>{fileName}</strong>
        </div>
    );
};

export default ToastFileChange;
