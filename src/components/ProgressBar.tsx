import { ProgressBar as BlueprintProgressBar, Intent } from '@blueprintjs/core';
import 'styles/components/ProgressBar.scss';

interface ProgressBarProps {
    progress: number;
    estimated: number;
}

function ProgressBar({ progress, estimated }: ProgressBarProps) {
    return (
        <div className='progress-bar'>
            <span className='status'>
                {progress > 0 ? `${Math.round(progress * 100)}%` : `100%`}
                {` - `}
                {estimated > 0 ? `${Math.round(estimated)}s left` : '0s left'}
            </span>

            <BlueprintProgressBar
                value={progress}
                intent={Intent.SUCCESS}
            />
        </div>
    );
}

export default ProgressBar;
