#!/bin/sh

# Pinggy free tunnels accept an empty SSH password. SSH_ASKPASS_REQUIRE=force
# makes this work without a terminal prompt when the public relay runs unattended.
printf '\n'

