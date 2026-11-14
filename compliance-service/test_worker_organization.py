"""Tests for worker.py's use of organization folders, with a stand-in for Supabase (no model is loaded, nothing
is sent anywhere).

Run:  python -m unittest test_worker_organization     (from compliance-service/)
"""
import shutil
import unittest
import uuid

import worker
from hawkim.organization_paths import WrongOrganizationPath

ORG = "6f1a6b0e-0000-4000-8000-000000000001"
OTHER = "6f1a6b0e-0000-4000-8000-000000000002"


class FakeSupabase:
    """Records every call; downloads and uploads fail the test if they happen."""

    def __init__(self):
        self.calls = []

    def rpc(self, name, params):
        self.calls.append(("rpc", name, params))
        return None

    def remove_folder(self, bucket, folder):
        self.calls.append(("remove_folder", bucket, folder))

    def remove_objects(self, bucket, paths):
        self.calls.append(("remove_objects", bucket, list(paths)))

    def download(self, *args, **kwargs):
        raise AssertionError("a file was downloaded")

    def download_object(self, *args, **kwargs):
        raise AssertionError("a file was downloaded")

    def upload_object(self, *args, **kwargs):
        raise AssertionError("a file was uploaded")


class CancelTest(unittest.TestCase):
    def test_removes_the_organizations_index_folder_and_file(self):
        version = str(uuid.uuid4())
        cache = worker.INDEX_CACHE / ORG / "versions" / version
        cache.mkdir(parents=True, exist_ok=True)
        try:
            sb = FakeSupabase()
            job = {"id": version, "version": "9.0", "organization_id": ORG, "storage_path": f"{ORG}/files/{version}.pdf"}
            worker.cancel_guideline(job, sb, missing=False)
            self.assertIn(("remove_folder", worker.GUIDELINE_INDEX_BUCKET, f"{ORG}/versions/{version}"), sb.calls)
            self.assertIn(("remove_objects", worker.GUIDELINE_FILES_BUCKET, [f"{ORG}/files/{version}.pdf"]), sb.calls)
            self.assertFalse(cache.exists(), "the local copy of the index is removed")
        finally:
            shutil.rmtree(worker.INDEX_CACHE / ORG, ignore_errors=True)

    def test_without_organizations_the_old_folder(self):
        version = str(uuid.uuid4())
        sb = FakeSupabase()
        worker.cancel_guideline({"id": version, "version": "9.0", "storage_path": f"files/{version}.pdf"}, sb, missing=False)
        self.assertIn(("remove_folder", worker.GUIDELINE_INDEX_BUCKET, f"versions/{version}"), sb.calls)

    def test_another_organizations_file_is_never_removed(self):
        version = str(uuid.uuid4())
        sb = FakeSupabase()
        job = {"id": version, "version": "9.0", "organization_id": ORG, "storage_path": f"{OTHER}/files/{version}.pdf"}
        with self.assertRaises(WrongOrganizationPath):
            worker.cancel_guideline(job, sb, missing=False)
        self.assertEqual(sb.calls, [], "nothing was removed")


class ProcessingTest(unittest.TestCase):
    def test_a_check_with_another_organizations_file_is_refused_before_reading_it(self):
        sb = FakeSupabase()
        job = {"check_id": str(uuid.uuid4()), "file_name": "a.pdf", "sop_version": 1, "organization_id": ORG,
               "storage_path": f"{OTHER}/user/a.pdf", "guideline_index_path": f"{ORG}/versions/{uuid.uuid4()}"}
        with self.assertRaises(WrongOrganizationPath):
            worker.process(job, svc=None, sb=sb, scfg={})
        self.assertEqual(sb.calls, [])

    def test_a_check_with_another_organizations_index_is_refused(self):
        sb = FakeSupabase()
        job = {"check_id": str(uuid.uuid4()), "file_name": "a.pdf", "sop_version": 1, "organization_id": ORG,
               "storage_path": f"{ORG}/user/a.pdf", "guideline_index_path": f"{OTHER}/versions/{uuid.uuid4()}"}
        with self.assertRaises(WrongOrganizationPath):
            worker.process(job, svc=None, sb=sb, scfg={})

    def test_a_gvp_version_with_another_organizations_pdf_is_refused_before_reading_it(self):
        version = str(uuid.uuid4())
        sb = FakeSupabase()
        job = {"id": version, "version": "9.0", "file_name": "gvp.pdf", "organization_id": ORG,
               "storage_path": f"{OTHER}/files/{version}.pdf"}
        with self.assertRaises(WrongOrganizationPath):
            worker.build_guideline(job, svc=None, sb=sb, tracker=None)
        self.assertEqual(sb.calls, [])


if __name__ == "__main__":
    unittest.main()
