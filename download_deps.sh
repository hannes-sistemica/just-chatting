#!/bin/bash

# Create directories
mkdir -p web/chat/lib
mkdir -p web/chat/fonts

# Download marked.js
echo "Downloading marked.js..."
curl -L "https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.2/marked.min.js" -o web/chat/lib/marked.min.js

# Download Material Icons font files
echo "Downloading Material Icons fonts..."
curl -L "https://fonts.gstatic.com/s/materialicons/v142/flUhRq6tzZclQEJ-Vdg-IuiaDsNZ.ttf" -o web/chat/fonts/MaterialIcons-Regular.ttf
curl -L "https://fonts.gstatic.com/s/materialicons/v140/flUhRq6tzZclQEJ-Vdg-IuiaDsNc.woff2" -o web/chat/fonts/MaterialIcons-Regular.woff2

echo "Dependencies downloaded successfully!"
