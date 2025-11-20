# Troubleshooting

## Fix for 'no keys found' error

<img width="492" alt="Screenshot 2025-01-30 at 1 55 10 PM" src="https://github.com/user-attachments/assets/3f7f9983-f92d-4900-9321-9d46c6355c36" />

Check your local ssh agent has your ssh key by running:

```shell
ssh-add -L
```

If your key isn't present, run the following on your local machine:

```shell
ssh-add
```

## Fix for python not finding modules

```shell
deactivate
rm -rf myenv
```

Then [follow the steps](https://docs.tenstorrent.com/ttnn-visualizer/src/contributing.html#back-end) for creating virtual environment and reinstalling dependencies

## Fix for missing distutils package

With the virtualenv activated run:

```shell
pip install --upgrade setuptools
```
