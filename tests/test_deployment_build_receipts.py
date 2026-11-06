from uuid import uuid4

from alcor_api.deployment_build_receipts import find_run


def test_receipt_matches_only_original_workflow_uuid():
    ident = uuid4()
    run = {"event": "workflow_dispatch", "path": ".github/workflows/docker-publish.yml", "head_branch": "main", "display_title": f"构建发布 {ident}"}
    calls = []
    def github(settings, path):
        calls.append(path)
        return {"workflow_runs": [run]}
    assert find_run(None, github, ident)
    assert not find_run(None, github, uuid4())
    run["path"] = ".github/workflows/ci.yml"
    assert not find_run(None, github, ident)
    assert all("/runs?" in path for path in calls)


def test_release_workflow_indexes_request_and_checks_confirmed_commit_before_build():
    from pathlib import Path

    import yaml
    root = Path(__file__).parents[1]
    workflow = yaml.safe_load((root / ".github/workflows/docker-publish.yml").read_text())
    assert "inputs.request_id" in workflow["run-name"]
    steps = workflow["jobs"]["publish"]["steps"]
    guard = next(i for i, step in enumerate(steps) if step.get("name") == "核对本次确认的提交")
    build = next(i for i, step in enumerate(steps) if "docker/build-push-action@" in step.get("uses", ""))
    assert guard < build and "EXPECTED_REVISION" in steps[guard]["run"]
    assert not any("updater" in str(step) for step in steps)


def test_malformed_or_truncated_history_is_not_reported_absent():
    import pytest
    from alcor_api.deployment_build_receipts import lookup_run
    for value in (None, [None], [{"display_title": None}]):
        with pytest.raises(TypeError):
            lookup_run(None, lambda *_, value=value: {"workflow_runs": value}, uuid4())
    calls = []
    def github(_settings, path):
        calls.append(path)
        return {"workflow_runs": [{} for _ in range(100)]}
    with pytest.raises(ValueError, match="truncated"):
        lookup_run(None, github, uuid4())
    assert len(calls) == 5
