# The smallest useful box. Copy this folder, fill in the values, then:
#   terraform init && terraform apply
module "workbench" {
  source = "../.."
  # From another repo, use the product's git source pinned to a release, e.g.
  # source = "git::https://github.com/mikephii/donkeybox.git//deploy/gcp?ref=v0.5.0"

  project_id      = "your-project"
  image           = "ghcr.io/mikephii/donkeybox:0.5.0"
  app_domain      = "workbench.example.com"
  hooks_domain    = "hooks.workbench.example.com"
  allowed_emails  = ["you@example.com"]
  bootstrap_admin = "you@example.com"
}

output "lb_ip" { value = module.workbench.lb_ip }
output "app_url" { value = module.workbench.app_url }
output "hooks_url" { value = module.workbench.hooks_url }
