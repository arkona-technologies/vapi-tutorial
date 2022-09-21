# BLADE//runner API Tutorial
This repository hosts a bunch of guided example scripts to serve as a tutorial to **BLADE//runner's** native *JSON/WebSockets* API and it's bundled *javascript/typescript* layer **vapi**.

## Introduction
Every Release of the **BLADE//runner** software automatically generates a JSON/WebSockets API based on the data structure used by the systems underlying control-software. Virtually every Parameter of System may be controlled and/or monitored this way, offering incredible flexibility. For more Information, take a look at [API.md](API.md).

In addition, each software release also comes bundled with **vscript**, a javascript library to interface with the aforementioned JSON/WebSockets API and **vapi**, a fully typed typescript wrapper for **vscript** so that you may enjoy features such as auto-completion, type-checking etc. while developing.

## Requirements 
Obviously you will need a **BLADE//runner** device (such as the *AT300*), visit https://arkonatech.com/ for more information.

Apart from that you will need node.js and npm, visit https://nodejs.org/en/ for more information on how to obtain it.

## Additional Requirements
Some scripts require some more specialized software for displaying or converting graphics, see [*Requirements.md*](requirements.md) for more information.


## Usage
By running `make.sh` you will be asked to provide the ip-address of your development blade from which vscript/vapi and vutil will be downloaded via npm. Additionaly it will make sure that the example scripts will be executed on your development blade via the *ip* parameter in `blade.json`.

Afterwards you can start the interactive tutorial by running `runkiosk.sh` and visiting http://localhost:4000.
