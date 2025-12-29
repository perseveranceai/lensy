#!/bin/bash

# Copy node_modules to compiled Lambda functions for deployment

echo "📦 Copying node_modules to compiled Lambda functions..."

# List of Lambda functions
FUNCTIONS=("url-processor" "structure-detector" "dimension-analyzer" "report-generator" "api-handler")

for func in "${FUNCTIONS[@]}"; do
    echo "  Copying $func dependencies..."
    if [ -d "lambda/$func/node_modules" ]; then
        cp -r "lambda/$func/node_modules" "lib/lambda/$func/"
        echo "  ✅ $func dependencies copied"
    else
        echo "  ⚠️  No node_modules found for $func"
    fi
done

echo "✅ All dependencies copied!"
