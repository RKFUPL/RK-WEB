import unittest

from app import create_app


class CorsTests(unittest.TestCase):
    def test_production_frontend_origins_allow_credentialed_actual_requests(self):
        app = create_app()
        for origin in ("https://rashikapoor.co.in", "https://www.rashikapoor.co.in"):
            with self.subTest(origin=origin):
                response = app.test_client().get(
                    "/api/health",
                    headers={"Origin": origin},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), origin)
                self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")

    def test_unrelated_origins_are_rejected(self):
        app = create_app()
        response = app.test_client().get(
            "/api/health",
            headers={"Origin": "https://unrelated.example"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))
        self.assertIsNone(response.headers.get("Access-Control-Allow-Credentials"))

    def test_production_frontend_preflight_allows_required_methods_and_headers(self):
        app = create_app()
        for origin in ("https://rashikapoor.co.in", "https://www.rashikapoor.co.in"):
            with self.subTest(origin=origin):
                response = app.test_client().options(
                    "/api/auth/me",
                    headers={
                        "Origin": origin,
                        "Access-Control-Request-Method": "POST",
                        "Access-Control-Request-Headers": "Authorization, Content-Type, X-RK-Visitor-ID",
                    },
                )
                self.assertEqual(response.status_code, 204)
                self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), origin)
                self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")
                self.assertIn("POST", response.headers.get("Access-Control-Allow-Methods", ""))
                allowed_headers = response.headers.get("Access-Control-Allow-Headers", "")
                for header in ("Authorization", "Content-Type", "X-RK-Visitor-ID"):
                    self.assertIn(header, allowed_headers)

    def test_admin_dashboard_actual_request_allows_local_frontend_origins(self):
        app = create_app()
        for origin in ("http://localhost:3000", "http://localhost:3001"):
            with self.subTest(origin=origin):
                response = app.test_client().get(
                    "/api/admin/dashboard?period=7d",
                    headers={"Origin": origin},
                )
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), origin)
                self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")

    def test_admin_dashboard_preflight_allows_local_frontend_origins(self):
        app = create_app()
        for origin in ("http://localhost:3000", "http://localhost:3001"):
            with self.subTest(origin=origin):
                response = app.test_client().options(
                    "/api/admin/dashboard",
                    headers={
                        "Origin": origin,
                        "Access-Control-Request-Method": "GET",
                        "Access-Control-Request-Headers": "Authorization, X-RK-Visitor-ID",
                    },
                )
                self.assertEqual(response.status_code, 204)
                self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), origin)
                self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")
                self.assertIn("GET", response.headers.get("Access-Control-Allow-Methods", ""))
                allowed_headers = response.headers.get("Access-Control-Allow-Headers", "")
                self.assertIn("Authorization", allowed_headers)
                self.assertIn("X-RK-Visitor-ID", allowed_headers)

    def test_staff_orders_preflight_is_publicly_negotiated_for_production_frontend(self):
        app = create_app()
        response = app.test_client().options(
            "/api/staff/orders",
            headers={
                "Origin": "https://rashikapoor.co.in",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Authorization",
            },
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://rashikapoor.co.in")
        self.assertIn("GET", response.headers.get("Access-Control-Allow-Methods", ""))
        self.assertIn("Authorization", response.headers.get("Access-Control-Allow-Headers", ""))

    def test_staff_orders_actual_request_still_requires_authentication(self):
        app = create_app()
        response = app.test_client().get("/api/staff/orders", headers={"Origin": "https://www.rashikapoor.co.in"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://www.rashikapoor.co.in")


if __name__ == "__main__":
    unittest.main()
