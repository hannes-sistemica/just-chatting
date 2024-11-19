#!/bin/bash

# Create directories
mkdir -p web/chat/lib
mkdir -p web/chat/fonts

# Download marked.js
echo "Downloading marked.js..."
curl -L "https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.2/marked.min.js" -o web/chat/lib/marked.min.js

# Download Material Icons font
echo "Downloading Material Icons font..."
curl -L "https://fonts.googleapis.com/icon?family=Material+Icons" -o web/chat/fonts/material-icons.css

# Download the actual font files referenced in the CSS
curl -L "https://fonts.gstatic.com/s/materialicons/v140/flUhRq6tzZclQEJ-Vdg-IuiaDsNc.woff2" -o web/chat/fonts/MaterialIcons-Regular.woff2

echo "Dependencies downloaded successfully!"
