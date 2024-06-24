import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Link } from 'react-router-dom';
import LocalFolderSelector from '../components/LocalFolderSelector';
import RemoteSyncConfigurator from '../components/RemoteSyncConfigurator';
import 'styles/components/Home.scss';

function Home() {
    return (
        <>
            <Link to='/operations'>View operations</Link>

            <div className='splash-screen home'>
                <div className='folder-picker-options'>
                    <fieldset>
                        <legend>Local folder</legend>
                        <Icon icon={IconNames.FOLDER_OPEN} size={150} />
                        <div className='folder-picker-wrapper'>
                            <LocalFolderSelector />
                        </div>
                    </fieldset>
                    <fieldset>
                        <legend>Remote Sync</legend>
                        <Icon icon={IconNames.CLOUD} size={150} />
                        <div className='folder-picker-wrapper'>
                            <RemoteSyncConfigurator />
                        </div>
                    </fieldset>
                </div>
            </div>
        </>
    );
}

export default Home;
