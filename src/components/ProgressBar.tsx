import { ProgressBar as BlueprintProgressBar } from '@blueprintjs/core';
import 'styles/components/ProgressBar.scss';
import { UploadProgress } from '../hooks/useLocal';

function ProgressBar({ progress, estimated }: UploadProgress) {
    return (
        <div className='progress-bar'>
            {progress && estimated ? (
                <span className='status'>
                    {progress > 0 ? `${Math.round(progress * 100)}%` : `100%`}
                    {` - `}
                    {estimated > 0 ? `${Math.round(estimated)}s left` : '0s left'}
                </span>
            ) : null}

            <BlueprintProgressBar value={progress} />
        </div>
    );
}

export default ProgressBar;
