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

    def test_invalid_or_unbounded_api_response_fails(self):
        for raw in (b'<html>ready</html>', b'[]', b'null', b'{}', b'x'*4097, b'\xff'):
            with self.subTest(raw=raw[:20]):
                self.assertIsNotNone(healthcheck.probe('api', lambda *a, **k: Response(raw)))

    def test_unready_never_leaks_server_body_or_exception_text(self):
        for status in (401, 503):
            def fail(*a, **k):
                raise urllib.error.HTTPError('http://private', status, 'SECRET', {}, None)
            result = healthcheck.probe('api', fail)
            self.assertNotIn('SECRET', result)
            self.assertNotIn('http://private', result)
            self.assertIn('尚未就绪' if status == 503 else 'HTTP 401', result)

    def test_connection_failure_remains_unhealthy_without_traceback(self):
        for error in (ConnectionRefusedError('SECRET'), TimeoutError('SECRET'), urllib.error.URLError('SECRET')):
            def fail(*a, **k): raise error
            result = healthcheck.probe('api', fail)
            self.assertIn('无法连接', result)
            self.assertNotIn('SECRET', result)

    def test_non_success_api_response_fails(self):
        self.assertIsNotNone(healthcheck.probe('api', lambda *a, **k: Response(status=204)))

    def test_retired_updater_and_invalid_components_never_make_network_calls(self):
        def unexpected(*a, **k):
            self.fail('invalid component must not reach a network endpoint')
        for component in ('updater', 'unknown', '', None):
            with self.subTest(component=component):
                self.assertEqual(healthcheck.probe(component, unexpected), '健康检查参数无效')


if __name__ == '__main__': unittest.main()
