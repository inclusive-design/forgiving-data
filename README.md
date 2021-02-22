# forgiving-data

## What is this?

Algorithms for processing and relating data in ways which promote ownership, representation and inclusion,
maintaining rather than effacing provenance.

## How to use it?

This is very early-stage work. The file `jobs/WeCount-ODC.json5` contains a very simple two-element
data pipeline which will check out git repositories to use as inputs for a "forgiving data merge".
Merged outputs together with provenance information linking back to the source data will be written
into directory `dataOutput`.

Run the sample pipeline by running

    node driver.js
