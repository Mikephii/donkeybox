# GCP module

One workbench box in a GCP project: a private Container-Optimized OS VM running the image, a
deletion-protected data disk with daily snapshots, Cloud NAT for egress, and an HTTPS load balancer
with IAP on the app host and an open hooks host. Start from `examples/minimal`.

Everything about using it (security, users, first boot, updates, restores) is in
[docs/hosting/gcp-iap.md](../../docs/hosting/gcp-iap.md).
