#!/bin/bash
# Build script for Netlify that creates .env file from environment variables

set -e

echo "Creating .env file for build..."

# Create .env file with Netlify environment variables
if [ -n "$EXPO_PUBLIC_SUPABASE_URL" ]; then
  echo "EXPO_PUBLIC_SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL" > .env
fi

if [ -n "$EXPO_PUBLIC_SUPABASE_ANON_KEY" ]; then
  echo "EXPO_PUBLIC_SUPABASE_ANON_KEY=$EXPO_PUBLIC_SUPABASE_ANON_KEY" >> .env
fi

echo "Environment file created. Building..."

# Run the actual build
npx expo export --platform web
