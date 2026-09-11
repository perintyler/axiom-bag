# Axiom infrastructure

Terraform for the Axiom datasets and monitors Barry ships logs to. Services
send logs when `ENABLE_AXIOM_LOGS=true` (see the launchd plists).

## Running Terraform here

```sh
barry bag infra axiom plan
```

There is no tfvars file — the API token comes from `AXIOM_TOKEN`, mapped onto
the `axiom_api_token` variable. Leave `axiom_org_id` empty for personal orgs.

To run terraform directly instead:

```sh
set -a; source .env; set +a
TF_VAR_axiom_api_token="$AXIOM_TOKEN" terraform plan
```

## State

`terraform.tfstate` is gitignored and has no remote backend, so losing it means
re-importing every resource by hand — and it holds values the API will not
return again.

It is NOT covered by core's nightly backup. That job scans
`~/repos/barry/infra` (`scripts/jobs/backup`), which this directory left when
the Axiom infra moved into this bag; its "no state found" alarm only fires when
EVERY state file is missing, so the loss of this one alone would be silent.
Back it up with the bag, or extend that job to scan bag infra roots.
