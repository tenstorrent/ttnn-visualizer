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

Report generation is not compatible with TTNN tracer. If you see this error,
it likely means that TTNN tracer has been enabled in the model. This is not
a setting in TT-Metal or TTNN, but rather a hard-coded value in several of the model
demos.

TTNN Visualizer can not be used with models that have `enable_trace = True`. Please
disable tracer in the model by changing it to `enable_trace = False`, in order to
generate reports for TTNN Visualizer.
