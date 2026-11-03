"""Only independent request-observability storage is outside business-read hashes.

Do not add audit, sessions, receipts, preferences, financial or source tables here.
A route's explicit abuse counter exception remains local to that route's test.
"""

REQUEST_TELEMETRY_TABLES = frozenset({
    "request_observations",
    "request_observation_producers",
    "request_rollup_state",
    "account_request_activity",
    "account_request_activity_batches",
    "account_request_activity_state",
})
