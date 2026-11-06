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
    jobs = workflow["jobs"]
    assert [jobs[key]["name"] for key in ("source", "web", "image", "release")] == [
        "核对发布条件",
        "TypeScript 检查",
        "构建 linux/amd64 镜像",
        "发布不可变版本清单",
    ]
    assert jobs["web"]["needs"] == "source"
    assert jobs["image"]["needs"] == ["source", "web"]
    assert jobs["release"]["needs"] == ["source", "image"]
    guard = next(step for step in jobs["source"]["steps"] if step.get("name") == "核对本次确认的提交")
    assert "EXPECTED_REVISION" in guard["run"]
    assert any(step.get("name") == "核实同一提交的完整检查" for step in jobs["source"]["steps"])
    assert any("docker/build-push-action@" in step.get("uses", "") for step in jobs["image"]["steps"])
    assert any(step.get("name") == "发布不可变版本清单" for step in jobs["release"]["steps"])
    assert not any("updater" in str(step) for step in jobs["image"]["steps"] + jobs["release"]["steps"])


def test_release_published_at_keeps_only_parsed_timestamps():
    from alcor_api.deployments import release_published_at

    assert release_published_at({"published_at": "2026-11-05T22:25:00Z"}) == "2026-11-05T22:25:00Z"
    assert release_published_at({"published_at": "nope"}) is None
    assert release_published_at(None) is None
    assert release_published_at({"published_at": 1}) is None


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
