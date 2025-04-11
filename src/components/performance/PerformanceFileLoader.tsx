import React, { useState } from 'react';

interface PerformanceFileLoaderProps {
    onFileLoad: (data: unknown) => void;
}

const PerformanceFileLoader: React.FC<PerformanceFileLoaderProps> = ({ onFileLoad }) => {
    const [, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setError(null);
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        setFileName(file.name);
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const result = e.target?.result as string;
                const parsedData = JSON.parse(result);
                setError(null);
                onFileLoad(parsedData);
            } catch (err) {
                setError('Invalid JSON file. Please upload a valid JSON.');
            }
        };

        reader.onerror = () => setError('Error reading file.');
        reader.readAsText(file);
    };

    return (
        <div style={{ maxWidth: 'auto', margin: '0', padding: 0 }}>
            <input
                type='file'
                id='file-upload'
                accept='.json'
                onChange={handleFileChange}
                style={{
                    display: 'block',
                    padding: '0',
                    borderRadius: '4px',
                    width: '100%',
                    cursor: 'pointer',
                }}
            />
            {error && <p style={{ color: 'red', marginTop: 10 }}>{error}</p>}
        </div>
    );
};

export default PerformanceFileLoader;
