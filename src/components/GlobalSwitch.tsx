// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Intent, Switch } from '@blueprintjs/core';
import classNames from 'classnames';
import 'styles/components/GlobalSwitch.scss';

interface GlobalSwitchProps {
    label: string;
    checked: boolean;
    onChange: (arg: boolean) => void;
    intent?: Intent;
    disabled?: boolean;
}

// This exists so that we can properly style intent on the Switch component according to our theme
function GlobalSwitch({ label, checked, onChange, intent = Intent.PRIMARY, disabled = false }: GlobalSwitchProps) {
    return (
        <Switch
            className={classNames('global-switch', intent)}
            label={label}
            checked={checked}
            disabled={disabled}
            onChange={() => {
                onChange(!checked);
            }}
        />
    );
}

export default GlobalSwitch;
