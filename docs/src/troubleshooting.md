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

Then {ref}`follow the steps <back-end>` for creating virtual environment and reinstalling dependencies

## Fix for missing distutils package

With the virtualenv activated run:

```shell
pip install --upgrade setuptools
```


## Fix for 'Event synchronization is not supported during trace capture' error

Report generation in TTNN is not compatible with trace capture. If you see this error,
it likely means that trace capture has been enabled in TTNN. This is not
a setting in TT-Metal or TTNN, but rather a hard-coded value in several of the models
and demos.

TTNN Visualizer can not be used with models or demos that use trace capture. Please
disable trace capture in order to generate reports for TTNN Visualizer.

How trace capture is enabled depends on the model or demo. In some cases you will see
`enable_trace = True` in the Python code. In other cases it may be enabled by a
`--enable_trace` CLI arg. Some tests use the PyTest `parametrize` decorator to run the
demo both with and without trace capture.

Models or demos that have trace capture enabled need to be modified to not use that
feature in order for report generation to work.
