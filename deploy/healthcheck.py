"""Local health checks: fail closed, with bounded and credential-free diagnostics."""
import argparse
import http.client
import json
import sys
import urllib.error
import urllib.request


def probe(component, opener=urllib.request.urlopen):
    if component not in {'api', 'updater'}:
        return '健康检查参数无效'
    port, path, timeout = (8080, '/health/container', 5) if component == 'api' else (8081, '/health', 3)
    try:
        with opener(f'http://127.0.0.1:{port}{path}', timeout=timeout) as response:
            if response.status != 200:
                return '服务尚未就绪'
            if component == 'api':
                raw = response.read(4097)
                if len(raw) > 4096:
                    return '健康响应无效'
                value = json.loads(raw)
                if not isinstance(value, dict) or value.get('status') != 'ready':
                    return 'API 或后台进程尚未就绪'
            elif response.read(1):
                return '更新器健康响应无效'
        return None
    except urllib.error.HTTPError as exc:
        if exc.code == 503:
            return ('API 尚未就绪：请检查数据库连接、结构升级及后台进程'
                    if component == 'api' else '更新器尚未就绪：请检查 API 状态及更新器配置')
        return f'健康检查返回 HTTP {exc.code}'
    except (OSError, urllib.error.URLError, http.client.HTTPException):
        return '服务暂时无法连接，请检查启动日志'
    except (ValueError, UnicodeError):
        return '健康响应无效'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('component', choices=['api', 'updater'])
    error = probe(parser.parse_args().component)
    if error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
