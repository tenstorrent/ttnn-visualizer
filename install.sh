#!/bin/bash
if [ -z "$PYTHON_ENV_DIR" ]; then
    PYTHON_ENV_DIR=$(pwd)/python_env
fi

PYTHON_VERSION="${PYTHON_VERSION:-3.10}"

# Ensure pyenv is installed
if ! command -v pyenv &> /dev/null; then
    echo "pyenv not found. Installing pyenv"
    curl https://pyenv.run | bash
    export PATH="$HOME/.pyenv/bin:$PATH"
    eval "$(pyenv init -)"
    eval "$(pyenv virtualenv-init -)"
fi

# Ensure desired Python version is installed via pyenv
if ! pyenv versions --bare | grep -q "^${PYTHON_VERSION}"; then
    echo "Installing Python ${PYTHON_VERSION} with pyenv"
    pyenv install "${PYTHON_VERSION}"
fi

echo "Setting local Python to v${PYTHON_VERSION}"
pyenv local "${PYTHON_VERSION}"

echo "Creating virtual env in: $PYTHON_ENV_DIR"
python3 -m venv $PYTHON_ENV_DIR

source $PYTHON_ENV_DIR/bin/activate

echo "Install TT-NN Visualizer"
pip install ttnn-visualizer
