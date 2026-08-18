import unittest

from app import create_app


class CorsTests(unittest.TestCase):
    def test_staff_orders_preflight_is_publicly_negotiated_for_production_frontend(self):
        app = create_app()
        response = app.test_client().options(
            "/api/staff/orders",
            headers={
                "Origin": "https://rkfupl.onrender.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Authorization",
            },
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://rkfupl.onrender.com")
        self.assertIn("GET", response.headers.get("Access-Control-Allow-Methods", ""))
        self.assertIn("Authorization", response.headers.get("Access-Control-Allow-Headers", ""))

    def test_staff_orders_actual_request_still_requires_authentication(self):
        app = create_app()
        response = app.test_client().get("/api/staff/orders", headers={"Origin": "https://rkfupl.onrender.com"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://rkfupl.onrender.com")


if __name__ == "__main__":
    unittest.main()
