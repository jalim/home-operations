#!/usr/bin/env python3
"""
Migration script for app-template v3.x to v4.x

Usage:
    ./scripts/migrate-to-v4.py <app-name>
    ./scripts/migrate-to-v4.py radarr
    ./scripts/migrate-to-v4.py --all   # Migrate all apps
    ./scripts/migrate-to-v4.py --dry-run radarr  # Preview changes

Changes applied:
1. Update schema URL from bjw-s/helm-charts to bjw-s-labs/helm-charts
2. Remove &app anchor from metadata.name
3. Remove install.remediation and upgrade sections
4. Change interval from 30m to 1h
5. Remove controller: <name> from service definitions
6. Convert backendRefs name: *app to identifier: app
7. Move pod.securityContext to defaultPodOptions.securityContext
8. Remove enabled: true from persistence
9. Remove ipFamilies/ipFamilyPolicy from service (optional)
10. Change UID/GID from 568 to 1000 (runAsUser, runAsGroup, fsGroup)
11. Update OCIRepository tag from 3.7.x to 4.5.0
"""

import argparse
import os
import re
import sys
from pathlib import Path


def migrate_ocirepository(content: str) -> tuple[str, list[str]]:
    """Update OCIRepository to use app-template v4.x."""
    changes = []

    # Update tag from 3.x.x to 4.5.0
    if re.search(r'tag: 3\.\d+\.\d+', content):
        content = re.sub(r'tag: 3\.\d+\.\d+', 'tag: 4.5.0', content)
        changes.append("Updated app-template tag to 4.5.0")

    return content, changes


def migrate_helmrelease(content: str, dry_run: bool = False) -> tuple[str, list[str]]:
    """Apply v4.x migrations to helmrelease content."""
    changes = []
    original = content

    # 1. Update schema URL
    old_schema = 'bjw-s/helm-charts'
    new_schema = 'bjw-s-labs/helm-charts'
    if old_schema in content:
        content = content.replace(old_schema, new_schema)
        changes.append(f"Updated schema URL: {old_schema} -> {new_schema}")

    # 2. Remove &app anchor from metadata.name
    if re.search(r'name: &app \w+', content):
        content = re.sub(r'name: &app (\w+)', r'name: \1', content)
        changes.append("Removed &app anchor from metadata.name")

    # 3. Remove install.remediation section
    install_pattern = r'\n  install:\n    remediation:\n      retries: \d+'
    if re.search(install_pattern, content):
        content = re.sub(install_pattern, '', content)
        changes.append("Removed install.remediation section")

    # 4. Remove upgrade section
    upgrade_pattern = r'\n  upgrade:\n    cleanupOnFail: true\n    remediation:\n      strategy: rollback\n      retries: \d+'
    if re.search(upgrade_pattern, content):
        content = re.sub(upgrade_pattern, '', content)
        changes.append("Removed upgrade section")

    # 5. Change interval from 30m to 1h
    if 'interval: 30m' in content:
        content = content.replace('interval: 30m', 'interval: 1h')
        changes.append("Changed interval: 30m -> 1h")

    # 6. Remove controller: <name> from service
    controller_pattern = r'\n        controller: \w+'
    if re.search(controller_pattern, content):
        content = re.sub(controller_pattern, '', content)
        changes.append("Removed controller field from service")

    # 7. Convert backendRefs name: *app to identifier: app
    backend_pattern = r'(backendRefs:\n\s+- )name: \*app'
    if re.search(backend_pattern, content):
        content = re.sub(backend_pattern, r'\1identifier: app', content)
        changes.append("Changed backendRefs name: *app -> identifier: app")

    # Also handle case in rules array
    rules_backend_pattern = r'(- backendRefs:\n\s+- )name: \*app'
    if re.search(rules_backend_pattern, content):
        content = re.sub(rules_backend_pattern, r'\1identifier: app', content)
        if "Changed backendRefs" not in str(changes):
            changes.append("Changed backendRefs name: *app -> identifier: app")

    # 8. Remove enabled: true from persistence
    enabled_pattern = r'\n        enabled: true'
    if re.search(enabled_pattern, content):
        content = re.sub(enabled_pattern, '', content)
        changes.append("Removed enabled: true from persistence")

    # 9. Move pod.securityContext to defaultPodOptions.securityContext
    # Find pod.securityContext block under a controller and move to defaultPodOptions
    lines = content.split('\n')
    new_lines = []
    pod_security_lines = []
    in_pod_block = False
    in_security_context = False
    skip_until_dedent = False
    pod_indent = 0

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()

        # Detect start of pod: block (8 spaces indent under controller)
        if stripped == 'pod:' and line.startswith('        pod:') and not line.startswith('          '):
            in_pod_block = True
            pod_indent = len(line) - len(stripped)
            i += 1
            continue

        # Inside pod block, look for securityContext
        if in_pod_block:
            current_indent = len(line) - len(line.lstrip()) if line.strip() else 999

            # Check if we've dedented out of pod block
            if line.strip() and current_indent <= pod_indent:
                in_pod_block = False
                in_security_context = False
                new_lines.append(line)
                i += 1
                continue

            # Detect securityContext: inside pod
            if stripped == 'securityContext:' or stripped.startswith('securityContext:'):
                in_security_context = True
                i += 1
                continue

            # Capture security context content (indented under securityContext)
            if in_security_context and line.strip():
                # Keep the line but adjust indentation (12 spaces -> 8 spaces)
                if line.startswith('            '):
                    pod_security_lines.append(line[4:])  # Remove 4 spaces
                i += 1
                continue

            # Skip empty lines inside pod block
            if not line.strip():
                i += 1
                continue

            i += 1
            continue

        new_lines.append(line)
        i += 1

    # If we found pod security context, insert defaultPodOptions before service
    if pod_security_lines:
        content = '\n'.join(new_lines)

        # Build defaultPodOptions block
        default_pod_options = '    defaultPodOptions:\n      securityContext:\n' + '\n'.join(pod_security_lines)

        # Insert before service:
        content = content.replace('\n    service:', '\n' + default_pod_options + '\n    service:')
        changes.append("Moved pod.securityContext to defaultPodOptions.securityContext")

    # 10. Change UID/GID from 568 to 1000
    uid_changed = False
    if 'runAsUser: 568' in content:
        content = content.replace('runAsUser: 568', 'runAsUser: 1000')
        uid_changed = True
    if 'runAsGroup: 568' in content:
        content = content.replace('runAsGroup: 568', 'runAsGroup: 1000')
        uid_changed = True
    if 'fsGroup: 568' in content:
        content = content.replace('fsGroup: 568', 'fsGroup: 1000')
        uid_changed = True
    if uid_changed:
        changes.append("Changed UID/GID from 568 to 1000")

    # 11. Remove 568 from supplementalGroups if present (now redundant)
    # Match supplementalGroups arrays and remove 568
    if re.search(r'supplementalGroups:.*\b568\b', content):
        # Handle inline array format: [568, 1000, 10000] -> [1000, 10000]
        content = re.sub(r'\[568, ', '[', content)
        content = re.sub(r', 568\]', ']', content)
        content = re.sub(r', 568,', ',', content)
        content = re.sub(r'\[568\]', '[1000]', content)  # If only 568
        changes.append("Removed 568 from supplementalGroups")

    # 12. Remove ipFamilies and ipFamilyPolicy from service
    if re.search(r'\n        ipFamilies:\n          - IPv4', content):
        content = re.sub(r'\n        ipFamilies:\n          - IPv4', '', content)
        changes.append("Removed ipFamilies from service")

    if re.search(r'\n        ipFamilyPolicy: SingleStack', content):
        content = re.sub(r'\n        ipFamilyPolicy: SingleStack', '', content)
        changes.append("Removed ipFamilyPolicy from service")

    # 11. Remove sectionName from parentRefs (v4 style often omits this)
    # Keeping this optional - uncomment if desired
    # if re.search(r'\n            sectionName: https', content):
    #     content = re.sub(r'\n            sectionName: https', '', content)
    #     changes.append("Removed sectionName from parentRefs")

    return content, changes


def get_app_paths(repo_root: Path) -> list[Path]:
    """Get all helmrelease.yaml paths in the default namespace."""
    apps_dir = repo_root / "kubernetes" / "apps" / "default"
    helmreleases = []

    if apps_dir.exists():
        for app_dir in apps_dir.iterdir():
            if app_dir.is_dir():
                # Check for app/helmrelease.yaml
                hr_path = app_dir / "app" / "helmrelease.yaml"
                if hr_path.exists():
                    helmreleases.append(hr_path)
                # Check for other subdirs like code/, tools/, sync/
                for subdir in app_dir.iterdir():
                    if subdir.is_dir() and subdir.name != "app":
                        hr_path = subdir / "helmrelease.yaml"
                        if hr_path.exists():
                            helmreleases.append(hr_path)

    return sorted(helmreleases)


def main():
    parser = argparse.ArgumentParser(
        description="Migrate app-template helmreleases from v3.x to v4.x"
    )
    parser.add_argument(
        "app",
        nargs="?",
        help="App name to migrate (e.g., radarr) or --all for all apps"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Migrate all apps in default namespace"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without modifying files"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all apps that can be migrated"
    )

    args = parser.parse_args()

    # Find repo root
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent

    if args.list:
        print("Apps available for migration:")
        for hr_path in get_app_paths(repo_root):
            rel_path = hr_path.relative_to(repo_root)
            print(f"  {rel_path}")
        return 0

    if not args.app and not args.all:
        parser.print_help()
        return 1

    # Get helmrelease paths to process
    if args.all:
        helmreleases = get_app_paths(repo_root)
    else:
        hr_path = repo_root / "kubernetes" / "apps" / "default" / args.app / "app" / "helmrelease.yaml"
        if not hr_path.exists():
            print(f"Error: HelmRelease not found at {hr_path}")
            return 1
        helmreleases = [hr_path]

    total_changes = 0

    for hr_path in helmreleases:
        rel_path = hr_path.relative_to(repo_root)

        # Process HelmRelease
        with open(hr_path, 'r') as f:
            content = f.read()

        new_content, changes = migrate_helmrelease(content, args.dry_run)

        # Also process OCIRepository in the same directory
        oci_path = hr_path.parent / "ocirepository.yaml"
        oci_changes = []
        oci_new_content = None
        if oci_path.exists():
            with open(oci_path, 'r') as f:
                oci_content = f.read()
            oci_new_content, oci_changes = migrate_ocirepository(oci_content)

        if not changes and not oci_changes:
            print(f"✓ {rel_path} - already migrated or no changes needed")
            continue

        total_changes += len(changes) + len(oci_changes)

        if args.dry_run:
            print(f"\n{'='*60}")
            print(f"DRY RUN: {rel_path}")
            print(f"{'='*60}")
            for change in changes:
                print(f"  • {change}")
            for change in oci_changes:
                print(f"  • {change}")
        else:
            # Create backup and write HelmRelease
            if changes:
                backup_path = str(hr_path) + ".bak"
                with open(backup_path, 'w') as f:
                    f.write(content)
                with open(hr_path, 'w') as f:
                    f.write(new_content)

            # Create backup and write OCIRepository
            if oci_changes and oci_new_content:
                oci_backup_path = str(oci_path) + ".bak"
                with open(oci_backup_path, 'w') as f:
                    with open(oci_path, 'r') as orig:
                        f.write(orig.read())
                with open(oci_path, 'w') as f:
                    f.write(oci_new_content)

            print(f"\n✓ Migrated: {rel_path}")
            for change in changes:
                print(f"    • {change}")
            for change in oci_changes:
                print(f"    • {change}")

    print(f"\n{'='*60}")
    if args.dry_run:
        print(f"DRY RUN COMPLETE: {total_changes} changes would be applied")
    else:
        print(f"MIGRATION COMPLETE: {total_changes} changes applied")
        print("\nNext steps:")
        print("  1. Review changes: git diff")
        print("  2. Remove backups if satisfied: find . -name '*.bak' -delete")

    return 0


if __name__ == "__main__":
    sys.exit(main())
