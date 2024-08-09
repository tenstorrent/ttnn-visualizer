interface ProgressBarProps {
    progress: number;
    estimated: number;
}

function ProgressBar({ progress, estimated }: ProgressBarProps) {
    return (
        <div>
            <span>
                {progress > 0 ? `${Math.round(progress * 100)}%` : `100%`}
                {` - `}
                {estimated > 0 ? `${Math.round(estimated)}s left` : ''}
            </span>

            <progress
                value={progress}
                max='1'
                style={{ width: '100%' }}
            />
        </div>
    );
}

export default ProgressBar;
