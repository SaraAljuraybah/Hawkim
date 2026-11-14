"""Tests for hawkim/organization_paths.py (no model is loaded).

Run:  python -m unittest test_organization_paths     (from compliance-service/)
"""
import unittest

from hawkim.organization_paths import WrongOrganizationPath, guideline_index_path, require_in_organization

ORG = "6f1a6b0e-0000-4000-8000-000000000001"
OTHER = "6f1a6b0e-0000-4000-8000-000000000002"
VERSION = "9d2c0000-0000-4000-8000-0000000000d1"


class IndexPathTest(unittest.TestCase):
    def test_in_the_organizations_folder(self):
        self.assertEqual(guideline_index_path({"id": VERSION, "organization_id": ORG}), f"{ORG}/versions/{VERSION}")

    def test_without_organizations_the_old_path(self):
        self.assertEqual(guideline_index_path({"id": VERSION}), f"versions/{VERSION}")
        self.assertEqual(guideline_index_path({"id": VERSION, "organization_id": None}), f"versions/{VERSION}")


class RequireInOrganizationTest(unittest.TestCase):
    def test_paths_of_the_jobs_organization_pass(self):
        require_in_organization({"organization_id": ORG}, f"{ORG}/user/file.pdf", f"{ORG}/versions/{VERSION}", None)

    def test_another_organizations_path_is_refused(self):
        with self.assertRaises(WrongOrganizationPath):
            require_in_organization({"organization_id": ORG}, f"{ORG}/user/file.pdf", f"{OTHER}/versions/{VERSION}")

    def test_an_old_path_is_refused_once_there_are_organizations(self):
        with self.assertRaises(WrongOrganizationPath):
            require_in_organization({"organization_id": ORG}, "user/file.pdf")

    def test_a_folder_that_only_starts_with_the_id_is_refused(self):
        with self.assertRaises(WrongOrganizationPath):
            require_in_organization({"organization_id": ORG}, f"{ORG}x/user/file.pdf")

    def test_without_organizations_nothing_is_checked(self):
        require_in_organization({}, "user/file.pdf", f"versions/{VERSION}")


if __name__ == "__main__":
    unittest.main()
