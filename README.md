<div align="center">

# home-operations

_GitOps-managed Kubernetes cluster for home infrastructure and services_

[![Renovate](https://github.com/jalim/home-operations/actions/workflows/renovate.yaml/badge.svg)](https://github.com/jalim/home-operations/actions/workflows/renovate.yaml)
[![Status](https://uptime.lumu.au/api/badge/2/status)](https://status.lumu.au)
[![KUMA](https://uptime.lumu.au/api/badge/2/status)](https://uptime.lumu.au/status/home)

</div>

---

## 📖 Overview

This repository contains the complete infrastructure-as-code for my home Kubernetes cluster. Everything from bare-metal provisioning to application deployment is managed through GitOps principles using Flux CD.

The cluster runs on Talos Linux and hosts 90+ applications across 18 namespaces, including media services, home automation, monitoring, and various utilities.

## ⭐ Features

- **Fully Automated GitOps**: All cluster state managed via Flux CD with automatic reconciliation
- **Immutable Infrastructure**: Talos Linux provides a secure, minimal OS designed for Kubernetes
- **High Availability**: 3-node control plane with virtual IP for API server redundancy
- **Distributed Storage**: Rook-Ceph cluster for persistent storage with replication
- **Secret Management**: SOPS with Age encryption for secure secret storage in Git
- **Automated Backups**: VolSync with Kopia for application data protection
- **Comprehensive Monitoring**: Prometheus, Grafana, and Gatus for observability
- **Self-Healing**: Automated dependency updates via Renovate and health monitoring

## 🏗️ Architecture

### Infrastructure

| Component | Implementation | Purpose |
|-----------|---------------|---------|
| **OS** | Talos Linux v1.11.1 | Immutable Linux distribution for Kubernetes |
| **Kubernetes** | v1.34.1 | Container orchestration platform |
| **GitOps** | Flux CD v2.6.4 | Continuous deployment from Git |
| **Secret Management** | SOPS + Age | Encrypted secrets in Git |
| **Storage** | Rook-Ceph | Distributed block and filesystem storage |
| **Backups** | VolSync + Kopia | Automated backup and replication |
| **Ingress** | NGINX Ingress Controller | HTTP/HTTPS traffic routing |
| **Certificates** | cert-manager | Automatic TLS certificate management |
| **DNS** | External DNS + k8s-gateway | Dynamic DNS and service discovery |
| **Monitoring** | Prometheus + Grafana | Metrics, alerting, and visualization |

### Cluster Details

```
Control Plane Nodes: 3 (k8s-0, k8s-1, k8s-2)
Node Network:        10.88.0.0/24
Pod Network:         10.42.0.0/16
Service Network:     10.43.0.0/16
API Endpoint:        10.88.0.20:6443 (HA Virtual IP)
```

## 📦 Applications

<details>
<summary><b>Media & Entertainment (17 apps)</b></summary>

- **Media Servers**: Plex, Jellyfin
- **Media Management**: Radarr, Sonarr, Lidarr, Readarr, Prowlarr
- **Media Requests**: Jellyseerr, Overseerr
- **Download Clients**: qBittorrent, SABnzbd
- **Media Automation**: Autobrr, Cross-Seed, Unpackerr
- **Media Analytics**: Tautulli, Jellystat, Jellyplex-Watched
- **Content**: Audiobookshelf, Pinchflat

</details>

<details>
<summary><b>Home Automation (4 apps)</b></summary>

- Home Assistant
- ESPHome
- Zigbee2MQTT
- EMQX (MQTT broker)

</details>

<details>
<summary><b>Productivity & Utilities (8 apps)</b></summary>

- Actual Budget (personal finance)
- Mealie (recipe management)
- Changedetection.io (website monitoring)
- Hugo (static site generator)
- IT-Tools
- Homebox (inventory management)
- Scrypted (video/camera integration)
- Valheim (game server)

</details>

<details>
<summary><b>Infrastructure & System (30+ apps)</b></summary>

- **Databases**: CloudNative-PG (PostgreSQL), Dragonfly (Redis)
- **Storage**: Rook-Ceph, MinIO, Local-Path-Provisioner, VolSync
- **Networking**: External DNS, k8s-gateway, Multus, Echo Server
- **Monitoring**: Prometheus, Grafana, Gatus, Alertmanager
- **Exporters**: Smartctl, SNMP, Blackbox
- **Security**: cert-manager, External Secrets Operator
- **System**: Reloader, Descheduler, Node Feature Discovery, Intel Device Plugin
- **CI/CD**: GitHub Actions Runner Scale Set
- **Kubernetes**: Metrics Server, CoreDNS, Cilium, System Upgrade Controller

</details>

## 🚀 Getting Started

### Prerequisites

- **Hardware**: 3 nodes (physical or virtual) capable of running Talos Linux
- **Network**: Static IP addresses, DHCP, DNS, and ability to configure a virtual IP
- **Storage**: Additional disks for Rook-Ceph (recommended)
- **Tools**:
  - `talosctl` - Talos CLI
  - `kubectl` - Kubernetes CLI
  - `flux` - Flux CD CLI
  - `task` - Task runner
  - `sops` and `age` - Secret encryption
  - `helm` - Kubernetes package manager

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/jalim/home-operations.git
   cd home-operations
   ```

2. **Generate Age encryption key**
   ```bash
   task sops:age-keygen
   ```

3. **Bootstrap Talos cluster**
   ```bash
   task talos:bootstrap
   ```

4. **Deploy Flux CD**
   ```bash
   task bootstrap:flux
   ```

5. **Deploy applications**
   ```bash
   task bootstrap:apps
   ```

> **Note**: For detailed setup instructions, see [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)

## 🛠️ Repository Structure

```
📁 home-operations/
├── 📁 .github/workflows/     # CI/CD automation (Renovate, linting, releases)
├── 📁 .taskfiles/            # Task automation for operations
├── 📁 ansible/               # Ansible playbooks (if used)
├── 📁 kubernetes/
│   └── 📁 main/
│       ├── 📁 apps/          # Application deployments (90+ apps)
│       ├── 📁 bootstrap/     # Cluster initialization configs
│       ├── 📁 flux/          # Flux CD configuration
│       └── 📁 templates/     # Reusable templates
├── 📄 .sops.yaml            # SOPS encryption rules
├── 📄 Taskfile.yaml         # Main task automation entrypoint
└── 📄 README.md             # This file
```

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/GETTING-STARTED.md) | Detailed bootstrap and installation guide |
| [Architecture](docs/ARCHITECTURE.md) | System design and infrastructure overview |
| [Applications](docs/APPLICATIONS.md) | Complete application inventory |
| [Operations](docs/OPERATIONS.md) | Day-to-day operational tasks |
| [Maintenance](docs/MAINTENANCE.md) | Upgrade and maintenance procedures |
| [Disaster Recovery](docs/DISASTER-RECOVERY.md) | Backup and recovery procedures |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and solutions |
| [Networking](docs/NETWORKING.md) | Network configuration and topology |
| [Secrets Management](docs/SECRETS.md) | Working with encrypted secrets |

## 🔧 Common Tasks

```bash
# List all available tasks
task --list

# View cluster status
kubectl get nodes
kubectl get pods -A

# Sync Flux
flux reconcile source git flux-system

# Upgrade Talos OS
task talos:upgrade-cluster

# Upgrade Kubernetes
task talos:upgrade-k8s

# Browse PVC contents
task kubernetes:browse-pvc

# View application logs
kubectl logs -n <namespace> <pod-name>
```

## 🔐 Secret Management

Secrets are encrypted using SOPS with Age encryption and stored directly in Git. The encryption key (`age.key`) is stored securely outside this repository.

```bash
# Encrypt a file
task sops:encrypt FILE=path/to/secret.yaml

# View encrypted file
sops path/to/secret.sops.yaml

# Edit encrypted file
sops path/to/secret.sops.yaml
```

See [docs/SECRETS.md](docs/SECRETS.md) for detailed instructions.

## 🔄 Automated Updates

**Renovate** runs hourly to check for updates to:
- Helm chart versions
- Container images
- Kubernetes manifests
- GitHub Actions

Updates are automatically submitted as pull requests for review.

## 📊 Monitoring & Observability

- **Grafana**: https://grafana.yourdomain.com (replace with actual URL)
- **Prometheus**: Metrics collection and alerting
- **Gatus**: Uptime monitoring at https://status.lumu.au/status/home
- **Alert Manager**: Alert routing and notifications

## 🆘 Support & Community

- **Issues**: [GitHub Issues](https://github.com/jalim/home-operations/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jalim/home-operations/discussions)

## 🙏 Acknowledgements

This repository is inspired by and built upon the excellent work of the [Home Operations](https://github.com/onedr0p/home-ops) and [k8s-at-home](https://github.com/k8s-at-home) communities.

Special thanks to:
- [onedr0p](https://github.com/onedr0p) for the original template and patterns
- The k8s-at-home community for application Helm charts
- The Talos, Flux, and Rook communities for excellent tooling

## 📝 License

This repository is provided as-is for educational and reference purposes. See [LICENSE](LICENSE) for details.

---

<div align="center">

**⭐ If you find this repository useful, please consider giving it a star!**

</div>
