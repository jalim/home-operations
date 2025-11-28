# GitLab Runner Cache Configuration

The GitLab runner has a persistent cache volume mounted at `/cache` that persists between job runs.

## Usage in .gitlab-ci.yml

### Alpine Linux (apk)

```yaml
before_script:
  # Set APK cache directory
  - export APK_CACHE_DIR=/cache/apk
  - mkdir -p $APK_CACHE_DIR
  - apk add --cache-dir $APK_CACHE_DIR <packages>
```

### Debian/Ubuntu (apt)

```yaml
variables:
  APT_CACHE_DIR: /cache/apt

before_script:
  - mkdir -p $APT_CACHE_DIR/archives/partial
  - apt-get update -o Dir::Cache=$APT_CACHE_DIR
  - apt-get install -y -o Dir::Cache=$APT_CACHE_DIR <packages>
```

### npm

```yaml
variables:
  npm_config_cache: /cache/npm

before_script:
  - npm ci
```

### pip (Python)

```yaml
variables:
  PIP_CACHE_DIR: /cache/pip

before_script:
  - pip install -r requirements.txt
```

### Go modules

```yaml
variables:
  GOCACHE: /cache/go-build
  GOMODCACHE: /cache/go-mod

before_script:
  - go mod download
```

### Maven

```yaml
variables:
  MAVEN_OPTS: "-Dmaven.repo.local=/cache/maven"
```

### Docker layer caching

For Docker-in-Docker builds, use BuildKit cache:

```yaml
variables:
  DOCKER_BUILDKIT: 1
  BUILDKIT_PROGRESS: plain

build:
  script:
    - docker build --cache-from type=local,src=/cache/docker --cache-to type=local,dest=/cache/docker -t myimage .
```

## Cache Directories

All caches are stored under `/cache/` and persist between runs:

- `/cache/apk` - Alpine packages
- `/cache/apt` - Debian/Ubuntu packages
- `/cache/npm` - npm packages
- `/cache/pip` - Python packages
- `/cache/go-build` - Go build cache
- `/cache/go-mod` - Go modules
- `/cache/maven` - Maven dependencies
- `/cache/docker` - Docker BuildKit cache

## Storage

- **Size**: 10Gi
- **Storage Class**: gitlab-runner-cache (NFS - ReadWriteMany)
- **NFS Server**: 10.88.0.80
- **NFS Path**: /mnt/dead/gitlab-runner-cache
- **Shared**: All runner job pods share the same cache volume
