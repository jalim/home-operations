#!/bin/bash
# Migration script to move apps from kubernetes/main/apps to kubernetes/apps
# Usage: ./scripts/migrate-app.sh <namespace> <app-name>
# Example: ./scripts/migrate-app.sh default actual

set -euo pipefail

NAMESPACE="${1:-}"
APP="${2:-}"

if [[ -z "$NAMESPACE" || -z "$APP" ]]; then
    echo "Usage: $0 <namespace> <app-name>"
    echo "Example: $0 default actual"
    exit 1
fi

OLD_BASE="kubernetes/main/apps"
NEW_BASE="kubernetes/apps"
OLD_APP_PATH="${OLD_BASE}/${NAMESPACE}/${APP}"
NEW_APP_PATH="${NEW_BASE}/${NAMESPACE}/${APP}"
OLD_NS_KUSTOMIZATION="${OLD_BASE}/${NAMESPACE}/kustomization.yaml"
NEW_NS_KUSTOMIZATION="${NEW_BASE}/${NAMESPACE}/kustomization.yaml"
NEW_NS_PATH="${NEW_BASE}/${NAMESPACE}"

# Verify source exists
if [[ ! -d "$OLD_APP_PATH" ]]; then
    echo "Error: Source app not found at $OLD_APP_PATH"
    exit 1
fi

# Check if already migrated
if [[ -d "$NEW_APP_PATH" ]]; then
    echo "Warning: $NEW_APP_PATH already exists"
    read -p "Overwrite? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
    rm -rf "$NEW_APP_PATH"
fi

echo "=== Migrating ${NAMESPACE}/${APP} ==="

# Step 1: Create namespace directory if needed
if [[ ! -d "$NEW_NS_PATH" ]]; then
    echo "Creating namespace directory: $NEW_NS_PATH"
    mkdir -p "$NEW_NS_PATH"

    # Copy namespace.yaml if it exists
    if [[ -f "${OLD_BASE}/${NAMESPACE}/namespace.yaml" ]]; then
        cp "${OLD_BASE}/${NAMESPACE}/namespace.yaml" "${NEW_NS_PATH}/namespace.yaml"
        echo "  Copied namespace.yaml"
    fi

    # Create kustomization.yaml for the namespace (no namespace override - let ks.yaml control it)
    cat > "$NEW_NS_KUSTOMIZATION" << 'EOF'
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ./namespace.yaml
EOF
    echo "  Created kustomization.yaml"
fi

# Step 2: Copy app folder
echo "Copying app folder..."
cp -r "$OLD_APP_PATH" "$NEW_APP_PATH"

# Step 3: Update ks.yaml path (handle both quoted and unquoted paths)
echo "Updating ks.yaml path..."
if [[ -f "${NEW_APP_PATH}/ks.yaml" ]]; then
    # Handle unquoted paths
    sed -i '' "s|path: ./kubernetes/main/apps/${NAMESPACE}/${APP}|path: ./kubernetes/apps/${NAMESPACE}/${APP}|g" "${NEW_APP_PATH}/ks.yaml"
    # Handle quoted paths
    sed -i '' "s|path: \"./kubernetes/main/apps/${NAMESPACE}/${APP}|path: ./kubernetes/apps/${NAMESPACE}/${APP}|g" "${NEW_APP_PATH}/ks.yaml"
    # Remove trailing quote if present
    sed -i '' 's|/app"$|/app|g' "${NEW_APP_PATH}/ks.yaml"
fi

# Step 3b: Convert templates to components (process all subdirectories)
KS_YAML="${NEW_APP_PATH}/ks.yaml"
VOLSYNC_CONVERTED=false

for SUBDIR in "${NEW_APP_PATH}"/*/; do
    [[ -d "$SUBDIR" ]] || continue
    SUB_KUSTOMIZATION="${SUBDIR}kustomization.yaml"
    [[ -f "$SUB_KUSTOMIZATION" ]] || continue

    # Check if this subdir uses volsync template
    if grep -q "templates/volsync" "$SUB_KUSTOMIZATION"; then
        if [[ "$VOLSYNC_CONVERTED" == "false" ]]; then
            echo "Converting volsync template to component..."
            # Add components section to ks.yaml if not present
            if ! grep -q "components:" "$KS_YAML"; then
                awk '
                /app.kubernetes.io\/name:/ {
                    print
                    print "  components:"
                    print "    - ../../../../components/volsync"
                    next
                }
                { print }
                ' "$KS_YAML" > "${KS_YAML}.tmp" && mv "${KS_YAML}.tmp" "$KS_YAML"
            fi
            VOLSYNC_CONVERTED=true
            echo "  Added volsync component to ks.yaml"
        fi

        # Remove template reference from kustomization
        sed -i '' '/templates\/volsync/d' "$SUB_KUSTOMIZATION"
        echo "  Removed template reference from $(basename "$SUBDIR")/kustomization.yaml"
    fi

    # Remove namespace override from kustomization (causes issues with Flux)
    if grep -q "^namespace:" "$SUB_KUSTOMIZATION"; then
        sed -i '' '/^namespace:/d' "$SUB_KUSTOMIZATION"
        echo "  Removed namespace override from $(basename "$SUBDIR")/kustomization.yaml"
    fi
done

# Step 4: Add to new namespace kustomization.yaml
echo "Adding to new kustomization.yaml..."
if ! grep -q "- ./${APP}/ks.yaml" "$NEW_NS_KUSTOMIZATION"; then
    # Add the app entry before the last line or at end of resources
    if grep -q "^resources:" "$NEW_NS_KUSTOMIZATION"; then
        # Add under resources section
        echo "  - ./${APP}/ks.yaml" >> "$NEW_NS_KUSTOMIZATION"
    else
        # Add resources section
        echo "resources:" >> "$NEW_NS_KUSTOMIZATION"
        echo "  - ./${APP}/ks.yaml" >> "$NEW_NS_KUSTOMIZATION"
    fi
fi

# Step 5: Comment out in old namespace kustomization.yaml
echo "Commenting out in old kustomization.yaml..."
if [[ -f "$OLD_NS_KUSTOMIZATION" ]]; then
    sed -i '' "s|^  - ./${APP}/ks.yaml|  # - ./${APP}/ks.yaml|g" "$OLD_NS_KUSTOMIZATION"
fi

echo ""
echo "=== Migration complete! ==="
echo ""
echo "Summary:"
echo "  - Copied:     $OLD_APP_PATH -> $NEW_APP_PATH"
echo "  - Updated:    $NEW_APP_PATH/ks.yaml (path reference)"
echo "  - Modified:   $NEW_NS_KUSTOMIZATION (added app)"
echo "  - Modified:   $OLD_NS_KUSTOMIZATION (commented out app)"
echo ""
echo "Next steps:"
echo "  1. Review changes: git diff"
echo "  2. Test locally or commit and let Flux reconcile"
echo "  3. Optionally delete old app folder after verification"
