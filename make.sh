#! /bin/bash

while [ 1 -gt 0 ]
do
    echo -e "Please enter the URL of your AT300/C100:\c"
    read BLADE
               echo "Check if Blade exists?"
               if [ $(curl -LI $BLADE -o /dev/null -w '%{http_code}\n' -s) == "200" ]; 
               then 
                  echo "Blade seems to exist. Starting setup"
                  export $BLADE
                  echo "Installing dependencies..."
                  npm run setup 
                  echo "Compiling Kiosk..."
                  tsc -p tsconfig_kiosk.json
                  echo "Compiling Scripts..."
                  tsc -p tsconfig.json
                  break;
            else
            echo "Blade doesn't seem to exist"
            fi
done

