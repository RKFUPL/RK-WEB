import unittest

from app.rbac import STAFF_PERMISSIONS, effective_permissions


class EffectivePermissionsTests(unittest.TestCase):
    def test_customers_never_receive_staff_permissions(self):
        self.assertEqual(effective_permissions({"role": "customer", "permissions": list(STAFF_PERMISSIONS)}), [])

    def test_legacy_staff_retains_previous_full_access(self):
        self.assertEqual(effective_permissions({"role": "staff"}), list(STAFF_PERMISSIONS))

    def test_explicit_staff_allowlist_is_enforced(self):
        self.assertEqual(
            effective_permissions({"role": "staff", "permissions": ["orders:manage", "not-real"]}),
            ["orders:manage"],
        )

    def test_admin_has_all_operational_permissions(self):
        self.assertEqual(effective_permissions({"role": "admin", "permissions": []}), list(STAFF_PERMISSIONS))

    def test_inactive_accounts_have_no_permissions(self):
        self.assertEqual(effective_permissions({"role": "admin", "isActive": False}), [])


if __name__ == "__main__":
    unittest.main()
