# Linking reports

TT-NN Visualizer can attempt to link the current active memory and performance reports to provide additional data insights. This is only possible when the two reports are from the same run.

When both reports expose a `run_id` (memory: `report_metadata` in the SQLite database; performance: root `manifest.json`), that shared identity is preferred. If either side lacks a `run_id`, the visualizer falls back to matching device-operation names against performance `raw_op_code` values.

The current link status is indicated in the UI when both a memory and performance report are loaded. If reports fail to link it is likely they are not from the same run.

**Successful link**
<img width="876" height="684" alt="Reports are linked" src="https://github.com/user-attachments/assets/9d81c2ec-ff0e-4956-8d2e-cd8263e25579" />

**Failed link**
<img width="876" height="684" alt="Reports cannot be linked" src="https://github.com/user-attachments/assets/c2925a7f-6d42-40ae-b5d0-1191f93aefc1" />
