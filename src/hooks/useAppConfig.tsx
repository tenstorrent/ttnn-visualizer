// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

const useAppConfig = () => {
    return {
        getAppConfig: (name: string) => {
            return localStorage.getItem(name);
        },
        setAppConfig: (name: string, value: string) => {
            localStorage.setItem(name, value);
        },
        deleteAppConfig: (name: string) => {
            localStorage.removeItem(name);
        },
    };
};

export default useAppConfig;
