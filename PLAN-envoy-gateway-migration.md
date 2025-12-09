# Migration Plan: Cilium Gateway API to Envoy Gateway

## Overview

Migrate from Cilium's built-in Gateway API (which has issues with host-networked backends like Rook) to standalone Envoy Gateway.

## Current State

- **Cilium Gateway API** with `gatewayClassName: cilium`
- **Two Gateways** in `flux-system` namespace:
  - `internal` (10.88.0.22) - 21 HTTPRoutes
  - `external` (10.88.0.21) - 6 HTTPRoutes
- **TLS**: Wildcard cert `lumu-production-tls` managed by cert-manager
- **Problem**: Host-networked pods (Rook Ceph MGR) unreachable via Cilium Gateway

## Target State

- **Envoy Gateway** (`gateway.envoyproxy.io`) with `gatewayClassName: envoy`
- **Two Gateways** in `network` namespace:
  - `envoy-internal` (same IP: 10.88.0.22)
  - `envoy-external` (same IP: 10.88.0.21)
- **Cilium** with `envoy.enabled: false` and `gatewayAPI.enabled: false`

## Migration Strategy: Blue-Green with Same IPs

To minimize downtime, we'll:
1. Deploy Envoy Gateway with **temporary IPs** for testing
2. Verify all routes work correctly
3. Delete old Cilium gateways and immediately create Envoy gateways with the **same IPs**
4. Update all HTTPRoutes to point to new gateways
5. Disable Cilium's built-in Envoy

**Expected downtime**: ~30 seconds during IP switchover

---

## Phase 1: Preparation (No Downtime)

### 1.1 Create Envoy Gateway App Structure

```
kubernetes/apps/network/envoy-gateway/
├── ks.yaml
└── app/
    ├── kustomization.yaml
    ├── ocirepository.yaml
    ├── helmrelease.yaml
    ├── envoyproxy.yaml        # EnvoyProxy + GatewayClass + Gateways
    ├── policies.yaml          # Backend/Client TrafficPolicy
    ├── observability.yaml     # PodMonitor + ServiceMonitor
    └── httpsredirect.yaml     # HTTP->HTTPS redirect route
```

### 1.2 Files to Create

#### `kubernetes/apps/network/envoy-gateway/ks.yaml`

```yaml
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: envoy-gateway
  namespace: flux-system
spec:
  dependsOn:
    - name: cert-manager
    - name: external-secrets-stores
  interval: 1h
  path: ./kubernetes/apps/network/envoy-gateway/app
  prune: true
  sourceRef:
    kind: GitRepository
    name: home-kubernetes
  targetNamespace: network
  wait: true
  timeout: 15m
```

#### `kubernetes/apps/network/envoy-gateway/app/ocirepository.yaml`

```yaml
---
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: envoy-gateway
spec:
  interval: 15m
  layerSelector:
    mediaType: application/vnd.cncf.helm.chart.content.v1.tar+gzip
    operation: copy
  ref:
    tag: v1.6.1
  url: oci://docker.io/envoyproxy/gateway-helm
```

#### `kubernetes/apps/network/envoy-gateway/app/helmrelease.yaml`

```yaml
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: envoy-gateway
spec:
  chartRef:
    kind: OCIRepository
    name: envoy-gateway
  interval: 1h
  values:
    config:
      envoyGateway:
        logging:
          level:
            default: info
        provider:
          type: Kubernetes
          kubernetes:
            deploy:
              type: GatewayNamespace
```

#### `kubernetes/apps/network/envoy-gateway/app/envoyproxy.yaml`

```yaml
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: EnvoyProxy
metadata:
  name: envoy-proxy-config
spec:
  logging:
    level:
      default: info
  provider:
    type: Kubernetes
    kubernetes:
      envoyDeployment:
        replicas: 2
        container:
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              memory: 1Gi
      envoyService:
        externalTrafficPolicy: Local
  shutdown:
    drainTimeout: 60s
  telemetry:
    metrics:
      prometheus:
        compression:
          type: Gzip
---
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: envoy
spec:
  controllerName: gateway.envoyproxy.io/gatewayclass-controller
  parametersRef:
    group: gateway.envoyproxy.io
    kind: EnvoyProxy
    name: envoy-proxy-config
    namespace: network
---
# PHASE 1: Use temporary IPs for testing
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: envoy-internal
  annotations:
    external-dns.alpha.kubernetes.io/target: 10.88.0.24
spec:
  gatewayClassName: envoy
  infrastructure:
    annotations:
      external-dns.alpha.kubernetes.io/hostname: internal-test.lumu.au
      lbipam.cilium.io/ips: 10.88.0.24
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      hostname: "*.lumu.au"
      allowedRoutes:
        namespaces:
          from: Same
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.lumu.au"
      allowedRoutes:
        namespaces:
          from: All
      tls:
        certificateRefs:
          - kind: Secret
            name: lumu-production-tls
            namespace: flux-system
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: envoy-external
  annotations:
    external-dns.alpha.kubernetes.io/target: 210.56.150.86,10.88.0.25
    gatus.home-operations.com/endpoint: |
      client:
        dns-resolver: tcp://1.1.1.1:53
      conditions:
        - "[STATUS] == 200"
      alerts:
        - type: pushover
spec:
  gatewayClassName: envoy
  infrastructure:
    annotations:
      lbipam.cilium.io/ips: 10.88.0.25
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      hostname: "*.lumu.au"
      allowedRoutes:
        namespaces:
          from: Same
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.lumu.au"
      allowedRoutes:
        namespaces:
          from: All
      tls:
        certificateRefs:
          - kind: Secret
            name: lumu-production-tls
            namespace: flux-system
```

#### `kubernetes/apps/network/envoy-gateway/app/policies.yaml`

```yaml
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: envoy-backend-policy
spec:
  targetSelectors:
    - group: gateway.networking.k8s.io
      kind: Gateway
  connection:
    bufferLimit: 8Mi
  tcpKeepalive: {}
  timeout:
    http:
      requestTimeout: 0s  # No timeout (for long-running connections like websockets)
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: ClientTrafficPolicy
metadata:
  name: envoy-client-policy
spec:
  targetSelectors:
    - group: gateway.networking.k8s.io
      kind: Gateway
  clientIPDetection:
    xForwardedFor:
      numTrustedHops: 1
  connection:
    bufferLimit: 8Mi
  http2:
    initialStreamWindowSize: 2Mi
    initialConnectionWindowSize: 32Mi
  tcpKeepalive: {}
  timeout:
    http:
      requestReceivedTimeout: 0s
  tls:
    minVersion: "1.2"
    alpnProtocols:
      - h2
      - http/1.1
```

#### `kubernetes/apps/network/envoy-gateway/app/observability.yaml`

```yaml
---
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: envoy-proxy
spec:
  jobLabel: envoy-proxy
  namespaceSelector:
    matchNames:
      - network
  podMetricsEndpoints:
    - port: metrics
      path: /stats/prometheus
      honorLabels: true
  selector:
    matchLabels:
      app.kubernetes.io/component: proxy
      app.kubernetes.io/name: envoy
---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: envoy-gateway
spec:
  endpoints:
    - port: metrics
      path: /metrics
      honorLabels: true
  jobLabel: envoy-gateway
  namespaceSelector:
    matchNames:
      - network
  selector:
    matchLabels:
      control-plane: envoy-gateway
```

#### `kubernetes/apps/network/envoy-gateway/app/httpsredirect.yaml`

```yaml
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: https-redirect
  annotations:
    external-dns.alpha.kubernetes.io/controller: none
spec:
  parentRefs:
    - name: envoy-external
      namespace: network
      sectionName: http
    - name: envoy-internal
      namespace: network
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
```

#### `kubernetes/apps/network/envoy-gateway/app/kustomization.yaml`

```yaml
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ./ocirepository.yaml
  - ./helmrelease.yaml
  - ./envoyproxy.yaml
  - ./policies.yaml
  - ./observability.yaml
  - ./httpsredirect.yaml
```

### 1.3 Create ExternalSecret for TLS in Network Namespace

The TLS certificate needs to be available in the `network` namespace. Create an ExternalSecret:

```yaml
# kubernetes/apps/network/envoy-gateway/app/externalsecret.yaml
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: lumu-production-tls
spec:
  secretStoreRef:
    kind: ClusterSecretStore
    name: onepassword-connect
  target:
    name: lumu-production-tls
    template:
      type: kubernetes.io/tls
      data:
        tls.crt: "{{ .tls_crt | base64decode }}"
        tls.key: "{{ .tls_key | base64decode }}"
  data:
    - secretKey: tls_crt
      remoteRef:
        key: lumu-au-tls
        property: tls.crt
    - secretKey: tls_key
      remoteRef:
        key: lumu-au-tls
        property: tls.key
```

### 1.4 Update network/kustomization.yaml

Add `envoy-gateway` to the network namespace kustomization.

---

## Phase 2: Deploy and Test (No Downtime)

### 2.1 Deploy Envoy Gateway

```bash
# Commit and push changes
git add -A && git commit -m "feat: add envoy-gateway for testing"
git push

# Wait for Flux to reconcile
flux reconcile kustomization envoy-gateway --with-source
```

### 2.2 Verify Deployment

```bash
# Check Envoy Gateway controller
kubectl get pods -n network -l control-plane=envoy-gateway

# Check Gateway status
kubectl get gateway -n network

# Check that temporary IPs are assigned
kubectl get svc -n network | grep envoy
```

### 2.3 Test with Temporary Routes

Create a test HTTPRoute pointing to the new gateway:

```bash
# Test rook dashboard through new gateway
curl -sk --resolve rook.lumu.au:443:10.88.0.24 https://rook.lumu.au/
```

---

## Phase 3: Switchover (Brief Downtime ~30s)

### 3.1 Update All HTTPRoutes

All HTTPRoutes need their `parentRefs` updated from:
```yaml
parentRefs:
  - name: internal
    namespace: flux-system
```
to:
```yaml
parentRefs:
  - name: envoy-internal
    namespace: network
```

**Files to update** (internal gateway):
- `kubernetes/apps/default/actual/app/httproute.yaml`
- `kubernetes/apps/default/autobrr/app/httproute.yaml`
- `kubernetes/apps/default/changedetection/app/httproute.yaml`
- `kubernetes/apps/default/esphome/app/httproute.yaml`
- `kubernetes/apps/default/mealie/app/httproute.yaml`
- `kubernetes/apps/default/pinchflat/app/httproute.yaml`
- `kubernetes/apps/default/prowlarr/app/httproute.yaml`
- `kubernetes/apps/default/qbittorrent/app/httproute.yaml`
- `kubernetes/apps/default/radarr/app/httproute.yaml`
- `kubernetes/apps/default/radarr-kids/app/httproute.yaml`
- `kubernetes/apps/default/sabnzbd/app/httproute.yaml`
- `kubernetes/apps/default/sonarr/app/httproute.yaml`
- `kubernetes/apps/default/sonarr-kids/app/httproute.yaml`
- `kubernetes/apps/home-automation/zigbee2mqtt/app/httproute.yaml`
- `kubernetes/apps/observability/grafana/app/httproute.yaml`
- `kubernetes/apps/observability/kube-prometheus-stack/app/alertmanager/httproute.yaml`
- `kubernetes/apps/observability/kube-prometheus-stack/app/prometheus/httproute.yaml`
- `kubernetes/apps/rook-ceph/rook-ceph/cluster/httproute.yaml`
- `kubernetes/apps/selfhosted/search/app/httproute.yaml` (if exists)

**Files to update** (external gateway):
- `kubernetes/apps/default/audiobookshelf/app/httproute.yaml`
- `kubernetes/apps/default/jellyseerr/app/httproute.yaml`
- `kubernetes/apps/default/plex/app/httproute.yaml`
- `kubernetes/apps/default/tautulli/app/httproute.yaml`
- `kubernetes/apps/flux-system/.../httproute.yaml` (github-webhook)
- `kubernetes/apps/network/echo-server/app/httproute.yaml`
- `kubernetes/apps/observability/gatus/app/httproute.yaml`

### 3.2 Update Gateway IPs

Change the Envoy Gateway IPs from temporary to production:

```yaml
# envoy-internal: 10.88.0.24 -> 10.88.0.22
# envoy-external: 10.88.0.25 -> 10.88.0.21
```

### 3.3 Delete Cilium Gateway Resources

Remove or comment out the cilium-gateway kustomization from `cilium/ks.yaml`.

### 3.4 Disable Cilium Envoy

Update `kubernetes/apps/kube-system/cilium/app/helm/values.yaml`:

```yaml
envoy:
  enabled: false
gatewayAPI:
  enabled: false
```

### 3.5 Execute Switchover

```bash
# Single commit with all changes
git add -A && git commit -m "feat: migrate to envoy-gateway from cilium gateway"
git push

# Force immediate reconciliation
flux reconcile kustomization cilium --with-source
flux reconcile kustomization envoy-gateway --with-source
```

---

## Phase 4: Cleanup

### 4.1 Remove Cilium Gateway Files

Delete the entire `kubernetes/apps/kube-system/cilium/gateway/` directory.

### 4.2 Remove cilium-gateway Kustomization

Remove the `cilium-gateway` Kustomization from `cilium/ks.yaml`.

### 4.3 Verify Everything Works

```bash
# Test all services
curl -sk https://rook.lumu.au/
curl -sk https://grafana.lumu.au/
curl -sk https://plex.lumu.au/

# Check no old Cilium envoy pods
kubectl get pods -n kube-system | grep envoy
```

---

## Rollback Plan

If issues occur after switchover:

1. Re-enable Cilium Gateway:
   ```yaml
   # values.yaml
   envoy:
     enabled: true
   gatewayAPI:
     enabled: true
   ```

2. Revert HTTPRoute parentRefs to `flux-system/internal` or `flux-system/external`

3. Delete Envoy Gateway resources

---

## Files Summary

### New Files to Create
- `kubernetes/apps/network/envoy-gateway/ks.yaml`
- `kubernetes/apps/network/envoy-gateway/app/kustomization.yaml`
- `kubernetes/apps/network/envoy-gateway/app/ocirepository.yaml`
- `kubernetes/apps/network/envoy-gateway/app/helmrelease.yaml`
- `kubernetes/apps/network/envoy-gateway/app/envoyproxy.yaml`
- `kubernetes/apps/network/envoy-gateway/app/policies.yaml`
- `kubernetes/apps/network/envoy-gateway/app/observability.yaml`
- `kubernetes/apps/network/envoy-gateway/app/httpsredirect.yaml`
- `kubernetes/apps/network/envoy-gateway/app/externalsecret.yaml`

### Files to Modify
- `kubernetes/apps/network/kustomization.yaml` - add envoy-gateway
- `kubernetes/apps/kube-system/cilium/app/helm/values.yaml` - disable envoy
- `kubernetes/apps/kube-system/cilium/ks.yaml` - remove cilium-gateway
- All HTTPRoute files (update parentRefs)

### Files to Delete (Phase 4)
- `kubernetes/apps/kube-system/cilium/gateway/*`

---

## References

- [onedr0p/home-ops envoy-gateway](https://github.com/onedr0p/home-ops/tree/main/kubernetes/apps/network/envoy-gateway)
- [Envoy Gateway Documentation](https://gateway.envoyproxy.io/docs/)
- [Cilium Gateway API Issues with Host Network](https://github.com/cilium/cilium/issues/32592)
