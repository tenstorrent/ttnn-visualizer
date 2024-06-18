// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Button, Collapse } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import React, { useEffect } from 'react';
import { JSX } from 'react/jsx-runtime';
import '../scss/components/Collapsible.scss';

interface CollapsibleProps {
    label: string | JSX.Element;
    additionalElements?: string | JSX.Element;
    isOpen?: boolean;
    styles?: React.CSSProperties;
    contentStyles?: React.CSSProperties;
    keepChildrenMounted?: boolean;
    onClick?: () => void;
}

const Collapsible: React.FC<React.PropsWithChildren<CollapsibleProps>> = ({
    label,
    additionalElements = undefined,
    isOpen = true,
    styles = {},
    contentStyles = {},
    keepChildrenMounted = true,
    onClick,
    children,
}) => {
    const [isOpenState, setIsOpenState] = React.useState(isOpen);
    useEffect(() => {
        setIsOpenState(isOpen);
    }, [isOpen]);

    const icon = isOpenState ? IconNames.CARET_UP : IconNames.CARET_DOWN;
    return (
        <div className='collapsible-component' style={styles}>
            <div className='collapsible-controls'>
                {children && (
                    <Button
                        small
                        minimal
                        onClick={() => {
                            if (onClick) {
                                onClick();
                            }
                            setIsOpenState(!isOpenState);
                        }}
                        rightIcon={icon}
                    >
                        {label}
                    </Button>
                )}
                {!children && (
                    <div className='collapsible-label-wrap'>
                        <div className='collapsible-label'>{label}</div>
                    </div>
                )}
                {additionalElements && additionalElements}
            </div>
            {children && (
                <Collapse isOpen={isOpenState} keepChildrenMounted={keepChildrenMounted}>
                    <div style={contentStyles}>{children}</div>
                </Collapse>
            )}
        </div>
    );
};

export default Collapsible;
