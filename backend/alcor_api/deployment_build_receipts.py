"""Read-only recovery of dispatch receipts; never submits another workflow."""
import re


def find_run(settings, github, request_id):
    marker = re.compile(r"(?<![a-zA-Z0-9-])" + re.escape(str(request_id)) + r"(?![a-zA-Z0-9-])")
    for page in range(1, 6):
        runs = github(settings, f"/actions/workflows/docker-publish.yml/runs?event=workflow_dispatch&branch=main&per_page=100&page={page}")["workflow_runs"]
        if not isinstance(runs, list):
            raise ValueError("invalid workflow runs")
        for run in runs:
            if (run.get("event") == "workflow_dispatch"
                and run.get("path") == ".github/workflows/docker-publish.yml"
                and run.get("head_branch") == "main"
                and marker.search(run.get("display_title", ""))):
                return True
        if len(runs) < 100:
            break
    return False
