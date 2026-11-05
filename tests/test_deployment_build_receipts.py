from uuid import uuid4
from alcor_api.deployment_build_receipts import find_run


def test_receipt_matches_only_original_workflow_uuid():
    ident = uuid4()
    run = dict(event="workflow_dispatch", path=".github/workflows/docker-publish.yml", head_branch="main", display_title=f"构建发布 {ident}")
    calls = []
    def github(settings, path):
        calls.append(path)
        return {"workflow_runs": [run]}
    assert find_run(None, github, ident)
    assert not find_run(None, github, uuid4())
    run["path"] = ".github/workflows/ci.yml"
    assert not find_run(None, github, ident)
    assert all("/runs?" in path for path in calls)
