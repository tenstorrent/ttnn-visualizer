import 'styles/components/ProgressBar.scss';

interface ProgressBarProps {
    progress: number;
    estimated: number;
}

function ProgressBar({ progress, estimated }: ProgressBarProps) {
    return (
        <div className='progress-bar'>
            <span>
                {progress > 0 ? `${Math.round(progress * 100)}%` : `100%`}
                {` - `}
                {estimated > 0 ? `${Math.round(estimated)}s left` : '0s left'}
            </span>

            <progress
                value={progress}
                max='1'
            />
        </div>
    );
}

export default ProgressBar;
