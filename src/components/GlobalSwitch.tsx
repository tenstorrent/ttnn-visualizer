// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Intent, Switch } from '@blueprintjs/core';
import classNames from 'classnames';
import 'styles/components/GlobalSwitch.scss';

interface GlobalSwitchProps {
    label: string;
    checked: boolean;
    onChange: (arg: boolean) => void;
    intent?: Intent;
}

// This exists so that we can properly style intent on the Switch component according to our theme
function GlobalSwitch({ label, checked, onChange, intent = Intent.PRIMARY }: GlobalSwitchProps) {
    return (
        <Switch
            className={classNames('global-switch', intent)}
            label={label}
            checked={checked}
            onChange={() => {
                onChange(!checked);
            }}
        />
    );
}

export default GlobalSwitch;
