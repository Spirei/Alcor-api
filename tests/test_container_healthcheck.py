import unittest
import urllib.error
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location("container_healthcheck",Path(__file__).parents[1]/"deploy/healthcheck.py")
healthcheck=importlib.util.module_from_spec(spec);spec.loader.exec_module(healthcheck)


class Response:
    def __init__(self, raw=b'', status=200): self.raw, self.status = raw, status
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return self.raw[:limit]


class HealthCheckTests(unittest.TestCase):
    def test_api_requires_worker_ready_and_fixed_local_endpoint(self):
        calls = []
        def open_(url, timeout):
            calls.append((url, timeout)); return Response(b'{"status":"ready"}')
        self.assertIsNone(healthcheck.probe('api', open_))
        self.assertEqual(calls, [('http://127.0.0.1:8080/health/container', 5)])

    def test_alive_is_not_ready(self):
        self.assertIsNotNone(healthcheck.probe('api', lambda *a, **k: Response(b'{"status":"alive"}')))

    def test_updater_empty_success(self):
        self.assertIsNone(healthcheck.probe('updater', lambda *a, **k: Response()))

    def test_updater_rejects_an_unexpected_response_body(self):
        self.assertIsNotNone(healthcheck.probe('updater', lambda *a, **k: Response(b'<html>ready</html>')))

    def test_invalid_or_unbounded_api_response_fails(self):
        for raw in (b'<html>ready</html>', b'[]', b'null', b'{}', b'x'*4097, b'\xff'):
            with self.subTest(raw=raw[:20]):
                self.assertIsNotNone(healthcheck.probe('api', lambda *a, **k: Response(raw)))

    def test_unready_never_leaks_server_body_or_exception_text(self):
        for component in ('api', 'updater'):
            def fail(*a, **k):
                raise urllib.error.HTTPError('http://private', 503, 'SECRET', {}, None)
            result = healthcheck.probe(component, fail)
            self.assertNotIn('SECRET', result)
            self.assertNotIn('http://private', result)
            self.assertIn('尚未就绪', result)

    def test_connection_failure_remains_unhealthy_without_traceback(self):
        for error in (ConnectionRefusedError('SECRET'), TimeoutError('SECRET'), urllib.error.URLError('SECRET')):
            def fail(*a, **k): raise error
            result = healthcheck.probe('api', fail)
            self.assertIn('无法连接', result)
            self.assertNotIn('SECRET', result)

    def test_non_success_and_unknown_components_fail(self):
        self.assertIsNotNone(healthcheck.probe('api', lambda *a, **k: Response(status=204)))
        self.assertIsNotNone(healthcheck.probe('unknown'))


if __name__ == '__main__': unittest.main()
