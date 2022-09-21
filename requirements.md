# Reqirements

## vapi/vscript/vutil
The `make.sh` script will take care of installing the vapi,vscript and vutil packages from your BLADE//runner device to your system. 

Alternatively you can edit the `package.json` directly or install them manually via npm/yarn. In that case however make sure to update the `blade.json` in the .build directory manually 
or edit the scripts accordingly.

## Inkscape
Some Examples create small clips from .svg files. These require inkscape 1.12 or higher. If your Package Manager does not offer a sufficiently up-to-date version, 
please visit [inkscapes website for instructions](https://inkscape.org/release/1.2.1/) to obtain the latest version.

## kst

Some Examples visualize data via `kst`. If your Package Manager does not provide a package for kst, please visit [their homepage](https://kst-plot.kde.org/).

## imagemick

Some Examples render .jpg images that are downloaded from the blade. This uses [imagemick](https://imagemagick.org/)


## Install
### Ubuntu
If you are running Ubuntu/Debian or any other derivative using apt as it's default package manager. you may run:

apt install npm kst imagemick inkscape 
