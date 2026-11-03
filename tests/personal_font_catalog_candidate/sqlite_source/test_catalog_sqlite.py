from pathlib import Path

from personal_font_catalog_candidate.test_catalog import C, catalog


async def test_real_sqlite_identity_and_metadata_only_catalog_survive_old_root_and_source_offline(
    client, admin, old_pg, source_file
):
    before = Path(old_pg.locator).read_bytes()
    result, _command = await catalog(client, old_pg)
    assert Path(old_pg.locator).read_bytes() == before
    source_file[0].rename(source_file[0].with_name("offline-root"))
    Path(old_pg.locator).rename(Path(old_pg.locator).with_suffix(".offline"))
    page = await client.get(C + "/" + result["catalogId"])
    assert page.status_code == 200 and page.json()["counts"]["unassigned"] == 1
    assert not page.json()["contentVerified"] and not page.json()["entireSourceComplete"]
