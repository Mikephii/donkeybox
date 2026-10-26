output "lb_ip" {
  description = "Point both app_domain and hooks_domain at this address (A records)."
  value       = google_compute_global_address.doors.address
}

output "app_url" {
  value = "https://${var.app_domain}"
}

output "hooks_url" {
  description = "The base for webhook URLs; the box shows each source's full URL on its Sources page."
  value       = "https://${var.hooks_domain}"
}

output "vm" {
  value = google_compute_instance.box.name
}

output "data_disk" {
  value = google_compute_disk.data.name
}

output "snapshot_policy" {
  value = google_compute_resource_policy.snapshots.name
}

output "iap_audience" {
  value = google_compute_project_metadata_item.audience.value
}

output "ssh" {
  description = "Admin shell on the VM (needs roles/iap.tunnelResourceAccessor and OS Login)."
  value       = "gcloud compute ssh ${google_compute_instance.box.name} --project ${var.project_id} --zone ${var.zone} --tunnel-through-iap"
}
