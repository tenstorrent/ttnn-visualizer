declare global {
    interface Window {
        TTNN_VISUALIZER_CONFIG?: ServerConfig;
    }
}

interface ServerConfig {
    SERVER_MODE?: boolean;
}

const getServerConfig = (): ServerConfig | null => {
    return window?.TTNN_VISUALIZER_CONFIG || null;
};

export default getServerConfig;
