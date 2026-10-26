variable "project_id" {
  description = "GCP project for the box. Use a project of its own: the VM holds write tokens for your repos and services."
  type        = string
}

variable "name" {
  description = "Short name for this box; prefixes every resource, so several boxes can share a project."
  type        = string
  default     = "workbench"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name))
    error_message = "Lowercase letters, digits and dashes, 2 to 21 characters, starting with a letter."
  }
}

variable "region" {
  type    = string
  default = "australia-southeast1"
}

variable "zone" {
  type    = string
  default = "australia-southeast1-a"
}

variable "image" {
  description = "The workbench container image, pinned to a version, e.g. ghcr.io/mikephii/donkeybox:0.5.0 or an Artifact Registry path."
  type        = string
}

variable "app_domain" {
  description = "Host name people open, e.g. workbench.example.com. Point its DNS at the lb_ip output."
  type        = string
}

variable "hooks_domain" {
  description = "Host name webhooks are sent to, e.g. hooks.workbench.example.com. Point its DNS at the lb_ip output."
  type        = string
}

variable "allowed_emails" {
  description = "Google accounts allowed through IAP. This is the box's door: everyone on it can open a shell on the box. Roles (admin, member, viewer) are set in the app's Settings."
  type        = list(string)
}

variable "bootstrap_admin" {
  description = "Email of the first admin inside the app. Empty: the first person to finish the Setup page becomes admin."
  type        = string
  default     = ""
}

variable "workspace_remote" {
  description = "Optional git URL for the box's own config repo (config.json, workflow skills, scripts; not your code). Can also be set later in Settings."
  type        = string
  default     = ""
}

variable "machine_type" {
  type    = string
  default = "e2-standard-4"
}

variable "data_disk_size_gb" {
  description = "Size of the data disk (workspace, repo clones, runs, sign-ins, secrets, installed tools)."
  type        = number
  default     = 100
}

variable "data_disk_type" {
  type    = string
  default = "pd-balanced"
}

variable "snapshot_retention_days" {
  type    = number
  default = 14
}

variable "snapshot_start_time" {
  description = "Daily snapshot start, UTC, HH:00."
  type        = string
  default     = "17:00"
}

variable "subnet_cidr" {
  type    = string
  default = "10.60.0.0/24"
}

variable "iap_oauth2_client_id" {
  description = "Optional OAuth client for IAP. Empty uses the Google-managed client, which only admits accounts in your Google Workspace organisation; set one (after configuring the consent screen) to admit outside accounts."
  type        = string
  default     = ""
}

variable "iap_oauth2_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "enable_apis" {
  description = "Turn on the APIs the module needs. Set false if your project setup manages APIs."
  type        = bool
  default     = true
}

variable "extra_env" {
  description = "More environment variables for the container (for example WB_MANAGEMENT_TOKEN)."
  type        = map(string)
  default     = {}
  sensitive   = true
}
