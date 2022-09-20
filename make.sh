#! /bin/bash

while [ 1 -gt 0 ]
do
    echo -e "Please enter the IP-Address of your AT300/C100:\c"
    read BLADE
               echo "Check if Blade is reachable?"
               if [[ $(echo $BLADE | grep -E '^(http|https)*$' | wc -l) -gt 0 ]]
               then 
                  echo "please omit prefixes such http(s) etc..."
                  continue;
               fi
               if [ $(curl -LI http://$BLADE -o /dev/null -w '%{http_code}\n' -s) == "200" ]; 
               then 
                  echo "Blade seems to exist. Starting setup"
                  export BLADE
                  echo $BLADE >> ./blade_ip
                  BLADE_URL="http://${BLADE}"
                  echo $BLADE
                  echo $BLADE_URL
                  export BLADE_URL
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

