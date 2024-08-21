// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Helmet } from 'react-helmet-async';

export default function Operations() {
    return (
        <>
            <Helmet title='Styleguide' />

            <h2>Typography</h2>

            <p>
                <strong>Font family</strong>
            </p>
            <p>Arial Nova, Arial, sans-serif</p>

            <h1>Heading H1</h1>
            <h2>Heading H2</h2>
            <h3>Heading H3</h3>
            <h4>Heading H4</h4>
            <h5>Heading H5</h5>

            <p>
                <strong>Paragraph</strong>
            </p>
            <p>
                Lorem ipsum dolor sit amet consectetur adipisicing elit. Error laborum atque suscipit. Officiis fugit
                necessitatibus libero perspiciatis sequi accusantium earum repudiandae deserunt nemo, voluptatem tempora
                laborum eaque minima molestiae eveniet.
            </p>

            <p>
                <strong>Monospace</strong>
            </p>
            <p className='monospace'>
                Lorem ipsum dolor sit, amet consectetur adipisicing elit. Magni nemo velit molestias quae temporibus
                sint in at consectetur voluptatem obcaecati, saepe, ratione, reprehenderit perferendis quas explicabo
                error repellendus deserunt? Optio!
            </p>

            <h2>Buttons</h2>

            <div style={{ display: 'flex', flexDirection: 'column', width: '150px', gap: '20px' }}>
                <div>
                    <p>Default</p>

                    <Button icon={IconNames.ADD}>Your text here</Button>
                    <Button
                        icon={IconNames.ADD}
                        minimal
                    >
                        Your text here
                    </Button>
                </div>

                <div>
                    <p>Primary</p>

                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.PRIMARY}
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.PRIMARY}
                        minimal
                    >
                        Your text here
                    </Button>
                </div>

                <div>
                    <p>Success</p>

                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.SUCCESS}
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.SUCCESS}
                        minimal
                    >
                        Your text here
                    </Button>
                </div>

                <div>
                    <p>Warning</p>

                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.WARNING}
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.WARNING}
                        minimal
                    >
                        Your text here
                    </Button>
                </div>

                <div>
                    <p>Danger</p>

                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.DANGER}
                    >
                        Your text here
                    </Button>
                    <Button
                        icon={IconNames.ADD}
                        intent={Intent.DANGER}
                        minimal
                    >
                        Your text here
                    </Button>
                </div>
            </div>
        </>
    );
}
