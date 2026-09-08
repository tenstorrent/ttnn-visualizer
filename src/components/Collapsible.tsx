// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, Collapse, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import React from 'react';
import { JSX } from 'react/jsx-runtime';
import 'styles/components/Collapsible.scss';
import classNames from 'classnames';

interface CollapsibleProps {
    label: string | JSX.Element;
    additionalElements?: string | JSX.Element;
    isOpen?: boolean;
    collapseClassName?: string;
    contentStyles?: React.CSSProperties;
    contentClassName?: string;
    keepChildrenMounted?: boolean;
    onExpandToggle?: (state: boolean) => void;
    isDisabled?: boolean;
    children?: React.ReactNode;
    // Builds the content only while the section is open, so a caller whose
    // collapsed content is huge never constructs that element tree (the NPE zone
    // filter can hold ~100k rows). Mutually exclusive with `children`; supplying
    // it forces unmount-on-collapse, so `keepChildrenMounted` is ignored — the
    // whole point is that nothing is retained while shut. #1803
    renderContent?: () => React.ReactNode;
}

const Collapsible = ({
    label,
    additionalElements = undefined,
    isOpen = true,
    collapseClassName = '',
    contentStyles = {},
    contentClassName = '',
    keepChildrenMounted = true,
    onExpandToggle,
    children,
    renderContent,
    isDisabled = false,
}: CollapsibleProps) => {
    const [isOpenState, setIsOpenState] = React.useState(isOpen);
    const [prevIsOpenProp, setPrevIsOpenProp] = React.useState(isOpen);
    const icon = isOpenState ? IconNames.CARET_UP : IconNames.CARET_DOWN;
    // A section is collapsible if it has content either way; `renderContent` is
    // only invoked while open, and it opts out of `keepChildrenMounted` so the
    // wiring matches what the prop comment promises.
    const hasContent = Boolean(children) || Boolean(renderContent);
    const content = renderContent ? isOpenState && renderContent() : children;
    const shouldKeepMounted = keepChildrenMounted && !renderContent;

    if (isOpen !== prevIsOpenProp) {
        setPrevIsOpenProp(isOpen);
        setIsOpenState(isOpen);
    }

    return (
        <div className={classNames('collapsible-component', collapseClassName)}>
            <div className='collapsible-controls'>
                {hasContent && (
                    <Button
                        size={Size.SMALL}
                        variant={ButtonVariant.MINIMAL}
                        className='collapsible-button'
                        onClick={
                            !isDisabled
                                ? () => {
                                      if (onExpandToggle) {
                                          onExpandToggle(!isOpenState);
                                      }
                                      setIsOpenState(!isOpenState);
                                  }
                                : undefined
                        }
                        endIcon={icon}
                    >
                        {label}
                    </Button>
                )}
                {!hasContent && (
                    <div className='collapsible-label-wrap'>
                        <div className='collapsible-label'>{label}</div>
                    </div>
                )}
                {additionalElements && additionalElements}
            </div>
            {hasContent && (
                <Collapse
                    isOpen={isOpenState}
                    keepChildrenMounted={shouldKeepMounted}
                >
                    <div
                        className={classNames(contentClassName)}
                        style={contentStyles}
                    >
                        {content}
                    </div>
                </Collapse>
            )}
        </div>
    );
};

export default Collapsible;
export const COLLAPSIBLE_EMPTY_CLASS = 'empty-collapsible';
