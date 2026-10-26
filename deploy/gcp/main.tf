# One workbench box on GCP: a private VM (Container-Optimized OS) running the workbench image, its
# data on a separate persistent disk (deletion-protected, snapshotted daily), and an HTTPS load
# balancer with two doors: the app host behind IAP, and the hooks host open for webhooks only.
# Replacing the VM loses nothing: everything mutable is on the data disk.

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  apis = ["compute.googleapis.com", "iap.googleapis.com", "secretmanager.googleapis.com", "logging.googleapis.com"]
  # Load balancer and health-check ranges: the only sources allowed to reach the box.
  lb_ranges     = ["35.191.0.0/16", "130.211.0.0/22"]
  audience_key  = "${var.name}-iap-audience"
  secret_prefix = "${var.name}-"
  env = merge({
    AUTH_MODE            = "iap"
    WB_SECRETS           = "gcp"
    WB_GCP_PROJECT       = var.project_id
    WB_GCP_SECRET_PREFIX = local.secret_prefix
    WB_HOOKS_DOOR_PORT   = "8081"
    # The management API answers only with WB_MANAGEMENT_TOKEN set (extra_env); the firewall lets
    # only IAP tunnels reach it.
    WB_MANAGEMENT_HOST       = "0.0.0.0"
    WB_SEED_PUBLIC_APP_URL   = "https://${var.app_domain}"
    WB_SEED_PUBLIC_HOOKS_URL = "https://${var.hooks_domain}"
    WB_BOOTSTRAP_ADMIN       = var.bootstrap_admin
    # The IAP list again, so terminal tokens of people removed from it are revoked.
    WB_ALLOWED_EMAILS = join(",", var.allowed_emails)
    WB_SEED_SETTINGS = jsonencode({
      workspaceRemote = var.workspace_remote == "" ? null : var.workspace_remote
      doors           = { appHosts = [var.app_domain], hooksHosts = [var.hooks_domain] }
    })
  }, var.extra_env)
}

resource "google_project_service" "apis" {
  for_each           = var.enable_apis ? toset(local.apis) : toset([])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ───────────── network: private VM, egress through NAT ─────────────

resource "google_compute_network" "net" {
  project                 = var.project_id
  name                    = "${var.name}-net"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "subnet" {
  project                  = var.project_id
  name                     = "${var.name}-subnet"
  region                   = var.region
  network                  = google_compute_network.net.id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true
}

resource "google_compute_router" "router" {
  project = var.project_id
  name    = "${var.name}-router"
  region  = var.region
  network = google_compute_network.net.id
}

resource "google_compute_router_nat" "nat" {
  project                            = var.project_id
  name                               = "${var.name}-nat"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

resource "google_compute_firewall" "lb_to_doors" {
  project       = var.project_id
  name          = "${var.name}-lb-to-doors"
  network       = google_compute_network.net.id
  direction     = "INGRESS"
  source_ranges = local.lb_ranges
  target_tags   = [var.name]
  allow {
    protocol = "tcp"
    ports    = ["8080", "8081"]
  }
}

# SSH and the management API (8002, for `wb update`) only through IAP TCP forwarding, for admins
# with the IAP tunnel role.
resource "google_compute_firewall" "iap_ssh" {
  project       = var.project_id
  name          = "${var.name}-iap-ssh"
  network       = google_compute_network.net.id
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = [var.name]
  allow {
    protocol = "tcp"
    ports    = ["22", "8002"]
  }
}

# ───────────── the box's identity ─────────────

resource "google_service_account" "box" {
  project      = var.project_id
  account_id   = "${var.name}-box"
  display_name = "Workbench box ${var.name}"
}

resource "google_project_iam_member" "logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.box.email}"
}

resource "google_project_iam_member" "metrics" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.box.email}"
}

resource "google_project_iam_member" "images" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.box.email}"
}

# The secrets store: the box manages only secrets named with its own prefix.
resource "google_project_iam_member" "secrets" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.box.email}"
  condition {
    title      = "${var.name}-secrets-only"
    expression = "resource.name.startsWith(\"projects/${data.google_project.this.number}/secrets/${local.secret_prefix}\")"
  }
}

# Listing needs a project-level permission without the name condition (names are filtered by label).
resource "google_project_iam_member" "secrets_list" {
  project = var.project_id
  role    = "roles/secretmanager.viewer"
  member  = "serviceAccount:${google_service_account.box.email}"
}

# ───────────── data disk: everything mutable lives here ─────────────

resource "google_compute_resource_policy" "snapshots" {
  project = var.project_id
  name    = "${var.name}-daily-snapshots"
  region  = var.region
  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = var.snapshot_start_time
      }
    }
    retention_policy {
      max_retention_days    = var.snapshot_retention_days
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }
    snapshot_properties {
      labels            = { workbench = var.name }
      storage_locations = [var.region]
    }
  }
}

resource "google_compute_disk" "data" {
  project = var.project_id
  name    = "${var.name}-data"
  zone    = var.zone
  type    = var.data_disk_type
  size    = var.data_disk_size_gb
  labels  = { workbench = var.name }
  # Terraform refuses to delete it; remove this block deliberately if you really mean to.
  lifecycle {
    prevent_destroy = true
  }
  depends_on = [google_project_service.apis]
}

resource "google_compute_disk_resource_policy_attachment" "data" {
  project = var.project_id
  name    = google_compute_resource_policy.snapshots.name
  disk    = google_compute_disk.data.name
  zone    = var.zone
}

# ───────────── the VM ─────────────

resource "google_compute_instance" "box" {
  project      = var.project_id
  name         = "${var.name}-vm"
  zone         = var.zone
  machine_type = var.machine_type
  tags         = [var.name]
  labels       = { workbench = var.name }

  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 30
    }
  }

  attached_disk {
    source      = google_compute_disk.data.id
    device_name = "workbench-data"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.subnet.id
    # No external address: traffic arrives through the load balancer; egress goes through NAT.
  }

  service_account {
    email  = google_service_account.box.email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot = true
  }

  metadata = {
    google-logging-enabled = "true"
    enable-oslogin         = "TRUE"
  }

  # Changing the image or settings replaces the VM; the data disk is reattached and nothing is lost.
  metadata_startup_script = templatefile("${path.module}/startup.sh.tftpl", {
    image        = var.image
    env          = local.env
    audience_key = local.audience_key
    registry     = split("/", var.image)[0]
  })

  allow_stopping_for_update = true
  depends_on                = [google_project_iam_member.secrets, google_project_iam_member.images]
}

resource "google_compute_instance_group" "box" {
  project   = var.project_id
  name      = "${var.name}-group"
  zone      = var.zone
  instances = [google_compute_instance.box.id]
  named_port {
    name = "app"
    port = 8080
  }
  named_port {
    name = "hooks"
    port = 8081
  }
}

# ───────────── doors: one HTTPS load balancer, two hosts ─────────────

resource "google_compute_health_check" "box" {
  project = var.project_id
  name    = "${var.name}-health"
  http_health_check {
    port         = 8080
    request_path = "/api/health"
  }
  check_interval_sec  = 15
  timeout_sec         = 5
  healthy_threshold   = 1
  unhealthy_threshold = 4
}

resource "google_compute_backend_service" "app" {
  project               = var.project_id
  name                  = "${var.name}-app"
  protocol              = "HTTP"
  port_name             = "app"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # Terminals and canvases hold websockets open; IAP allows up to an hour per connection.
  timeout_sec   = 3600
  health_checks = [google_compute_health_check.box.id]
  backend {
    group = google_compute_instance_group.box.id
  }
  iap {
    enabled              = true
    oauth2_client_id     = var.iap_oauth2_client_id == "" ? null : var.iap_oauth2_client_id
    oauth2_client_secret = var.iap_oauth2_client_secret == "" ? null : var.iap_oauth2_client_secret
  }
}

resource "google_compute_backend_service" "hooks" {
  project               = var.project_id
  name                  = "${var.name}-hooks"
  protocol              = "HTTP"
  port_name             = "hooks"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30
  health_checks         = [google_compute_health_check.box.id]
  backend {
    group = google_compute_instance_group.box.id
  }
}

# The box reads the IAP audience it must check from project metadata at boot (it cannot be in the
# VM's own metadata: the backend service depends on the VM).
resource "google_compute_project_metadata_item" "audience" {
  project = var.project_id
  key     = local.audience_key
  value   = "/projects/${data.google_project.this.number}/global/backendServices/${google_compute_backend_service.app.generated_id}"
}

resource "google_iap_web_backend_service_iam_binding" "people" {
  project             = var.project_id
  web_backend_service = google_compute_backend_service.app.name
  role                = "roles/iap.httpsResourceAccessor"
  members             = [for e in var.allowed_emails : "user:${e}"]
}

resource "google_compute_url_map" "doors" {
  project         = var.project_id
  name            = "${var.name}-doors"
  default_service = google_compute_backend_service.hooks.id
  host_rule {
    hosts        = [var.app_domain]
    path_matcher = "app"
  }
  host_rule {
    hosts        = [var.hooks_domain]
    path_matcher = "hooks"
  }
  path_matcher {
    name            = "app"
    default_service = google_compute_backend_service.app.id
  }
  path_matcher {
    name            = "hooks"
    default_service = google_compute_backend_service.hooks.id
  }
}

resource "google_compute_managed_ssl_certificate" "doors" {
  project = var.project_id
  name    = "${var.name}-cert"
  managed {
    domains = [var.app_domain, var.hooks_domain]
  }
}

resource "google_compute_target_https_proxy" "doors" {
  project          = var.project_id
  name             = "${var.name}-https"
  url_map          = google_compute_url_map.doors.id
  ssl_certificates = [google_compute_managed_ssl_certificate.doors.id]
}

resource "google_compute_global_address" "doors" {
  project = var.project_id
  name    = "${var.name}-ip"
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "${var.name}-https"
  target                = google_compute_target_https_proxy.doors.id
  ip_address            = google_compute_global_address.doors.address
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# Plain HTTP only redirects to HTTPS.
resource "google_compute_url_map" "redirect" {
  project = var.project_id
  name    = "${var.name}-redirect"
  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  project = var.project_id
  name    = "${var.name}-http"
  url_map = google_compute_url_map.redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  project               = var.project_id
  name                  = "${var.name}-http"
  target                = google_compute_target_http_proxy.redirect.id
  ip_address            = google_compute_global_address.doors.address
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
