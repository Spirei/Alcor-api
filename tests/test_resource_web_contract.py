from uuid import uuid4

from resource_test_support import resource_files, setup  # noqa:F401


async def test_web_discovery_uses_cookie_and_serves_only_own_original_bytes(client, db):
    await setup(client, db)
    response = await client.post(
        "/api/session/login", json={"login": "DeviceOwner", "password": "SyntheticDevicePassword9"}
    )
    assert response.status_code == 200, response.text
    client.headers["x-csrf-token"] = response.json()["csrf"]
    discovery = await client.get("/api/resource-library")
    assert discovery.status_code == 200
    assert discovery.json()["download_auth"] == "cookie"
    source = b"original resource\r\n"
    posted = await client.post(
        "/api/resource-library/files",
        data={"requestId": str(uuid4()), "category": "components", "name": "source.txt"},
        files={"file": ("source.txt", source, "text/plain")},
    )
    assert posted.status_code == 201, posted.text
    path = posted.json()["result"]["downloadPath"]
    downloaded = await client.get(path)
    assert downloaded.status_code == 200 and downloaded.content == source
    assert (await client.get(path, headers={"authorization": "Bearer invalid"})).status_code == 403
