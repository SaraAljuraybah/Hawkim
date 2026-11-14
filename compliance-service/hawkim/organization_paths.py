"""Where a job's files are, per organization (supabase/migrations/20261116230000_storage_organization_folders.sql).

Since multi-tenancy every stored file is in its organization's folder, and the database tells the worker each
job's organization (claim_compliance_check and claim_guideline_processing return organization_id,
20261116220000). A job from a database without those migrations has no organization_id: then the old paths are
used, so this worker also runs against a database that isn't migrated yet.
"""
from __future__ import annotations


class WrongOrganizationPath(RuntimeError):
    """A path the database gave for a job isn't in that job's organization's folder."""


def job_organization(job: dict) -> str | None:
    """The job's organization id, or None for a job from a database without organizations."""
    org = job.get("organization_id")
    return str(org) if org else None


def guideline_index_path(job: dict) -> str:
    """Where a GVP version's index is stored in guideline-indexes (and kept in index/ on this computer):
    <organization>/versions/<version id>, or versions/<version id> without organizations."""
    org = job_organization(job)
    return f"{org}/versions/{job['id']}" if org else f"versions/{job['id']}"


def require_in_organization(job: dict, *paths: str | None) -> None:
    """Refuses a job whose files aren't all in its organization's folder (nothing is read or written then).
    Without organizations there is nothing to check."""
    org = job_organization(job)
    if org is None:
        return
    for path in paths:
        if path is not None and not str(path).startswith(f"{org}/"):
            raise WrongOrganizationPath(f"{path} is not in the folder of the job's organization ({org})")
