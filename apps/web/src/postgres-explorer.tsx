import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Columns3,
  Database,
  LockKeyhole,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { SelectMenu } from "./select-menu";
import { ConnectionVerification } from "./connection-verification";
import { usePostgresExplorer } from "./postgres-explorer-context";
import "./postgres-explorer.css";

type Item = {
  name: string;
  kind?: string;
  estimated_rows?: number | null;
  accessible_tables?: number;
};
type Column = {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
  redacted: boolean;
};
type Preview = {
  columns: Column[];
  displayed_columns?: string[];
  rows: Record<string, string | null>[];
  has_more: boolean;
  offset: number;
  note: string;
};
type Catalog = {
  items: Item[];
  next: string | null;
  account: string;
  database: string;
};
type Query = {
  view: "databases" | "schemas" | "tables" | "rows";
  database?: string;
  schema_name?: string;
  table?: string;
  after?: string;
  offset?: number;
};

export function PostgresExplorer({ session }: { session: Session }) {
  const { proof, clear } = usePostgresExplorer();
  const [databases, setDatabases] = useState<Item[]>([]),
    [schemas, setSchemas] = useState<Item[]>([]),
    [tables, setTables] = useState<Item[]>([]);
  const [database, setDatabase] = useState(""),
    [schema, setSchema] = useState(""),
    [table, setTable] = useState("");
  const [databaseNext, setDatabaseNext] = useState<string | null>(null),
    [schemaNext, setSchemaNext] = useState<string | null>(null),
    [tableNext, setTableNext] = useState<string | null>(null);
  const [account, setAccount] = useState(""),
    [filter, setFilter] = useState(""),
    [tab, setTab] = useState<"data" | "structure">("data");
  const [preview, setPreview] = useState<Preview | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const alive = useRef(true),
    sequence = useRef(0),
    pending = useRef<(() => void) | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loadedTicket = useRef<string | null>(null);
  const selection = useRef({ database, schema, table, offset: 0 });
  selection.current = { database, schema, table, offset };

  async function request<T>(query: Query, accept: (value: T) => void) {
    if (!proof) return;
    const generation = ++sequence.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true);
    setError("");
    try {
      const value = await api<T>(
        "/connections/postgresql/inspect",
        {
          method: "POST",
          body: JSON.stringify({ ticket: proof.ticket, ...query }),
          signal: controller.current.signal,
        },
        session.csrf,
      );
      if (alive.current && generation === sequence.current) {
        pending.current = null;
        accept(value);
      }
    } catch (e) {
      if (
        !alive.current ||
        generation !== sequence.current ||
        (e instanceof Error && e.name === "AbortError")
      )
        return;
      if (e instanceof ApiError && e.code === "reauth_required") {
        pending.current = () => void request(query, accept);
        setVerifying(true);
      } else if (e instanceof ApiError && [401, 403, 410].includes(e.status)) {
        clear();
        setPreview(null);
        setTables([]);
      }
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      if (alive.current && generation === sequence.current) setLoading(false);
    }
  }
  function loadTables(db: string, ns: string, after = "") {
    if (!after) {
      setTable("");
      setPreview(null);
      setTables([]);
      setFilter("");
    }
    void request<Catalog>(
      { view: "tables", database: db, schema_name: ns, after },
      (value) => {
        setTables((old) => (after ? [...old, ...value.items] : value.items));
        setTableNext(value.next);
        setAccount(value.account);
      },
    );
  }
  function selectDatabase(db: string) {
    setDatabase(db);
    setSchema("");
    setSchemas([]);
    setTable("");
    setTables([]);
    setPreview(null);
    void request<Catalog>({ view: "schemas", database: db }, (value) => {
      setSchemas(value.items);
      setSchemaNext(value.next);
      setAccount(value.account);
      const first =
        value.items.find(
          (item) => item.name === "public" && (item.accessible_tables || 0) > 0,
        )?.name ||
        value.items.find((item) => (item.accessible_tables || 0) > 0)?.name ||
        value.items.find((item) => item.name === "public")?.name ||
        value.items[0]?.name ||
        "";
      setSchema(first);
      if (first) loadTables(db, first);
    });
  }
  function selectTable(name: string, offset = 0) {
    setOffset(offset);
    setTable(name);
    setPreview(null);
    void request<Preview>(
      { view: "rows", database, schema_name: schema, table: name, offset },
      setPreview,
    );
  }
  useEffect(() => {
    alive.current = true;
    if (
      proof &&
      loadedTicket.current === proof.ticket &&
      selection.current.database
    ) {
      const current = selection.current;
      if (current.table) {
        setPreview(null);
        void request<Preview>(
          {
            view: "rows",
            database: current.database,
            schema_name: current.schema,
            table: current.table,
            offset: current.offset,
          },
          setPreview,
        );
      } else if (current.schema) {
        void request<Catalog>(
          {
            view: "tables",
            database: current.database,
            schema_name: current.schema,
          },
          (value) => {
            setTables(value.items);
            setTableNext(value.next);
          },
        );
      }
    } else if (proof) {
      loadedTicket.current = proof.ticket;
      setDatabases([]);
      setSchemas([]);
      setTables([]);
      setPreview(null);
      setTable("");
      setOffset(0);
      void request<Catalog>({ view: "databases" }, (value) => {
        const list = value.items.some((item) => item.name === proof.database)
          ? value.items
          : [{ name: proof.database }, ...value.items];
        setDatabases(list);
        setDatabaseNext(value.next);
        setAccount(value.account);
        selectDatabase(proof.database);
      });
    }
    return () => {
      alive.current = false;
      sequence.current++;
      controller.current?.abort();
      pending.current = null;
      setVerifying(false);
    };
  }, [proof?.ticket]);

  return (
    <>
      <div className="page-heading pg-heading">
        <div>
          <h1>数据库浏览</h1>
          {proof && (
            <div className="pg-source">
              <Database size={14} />
              <span>{proof.endpoint}</span>
              <span className="pg-source-separator">·</span>
              <span>{account || proof.account}</span>
            </div>
          )}
        </div>
        <Link className="button secondary" to="/connections/postgresql">
          连接设置
        </Link>
      </div>
      {!proof ? (
        <div className="pg-explorer-empty">
          <Database size={30} />
          <h2>{error || "请先测试数据库连接"}</h2>
          <Link className="button primary" to="/connections/postgresql">
            前往连接设置
          </Link>
        </div>
      ) : (
        <div className="pg-explorer-layout">
          <aside className="pg-tree" aria-label="数据库对象">
            <div className="pg-tree-controls">
              <label>数据库</label>
              {databases.length > 0 && (
                <SelectMenu
                  label="数据库"
                  value={database || proof.database}
                  options={databases.map((item) => ({
                    value: item.name,
                    label: item.name,
                  }))}
                  variant="field"
                  onChange={selectDatabase}
                  disabled={loading}
                />
              )}
              {databaseNext && (
                <button
                  className="text-button"
                  disabled={loading}
                  onClick={() =>
                    void request<Catalog>(
                      { view: "databases", after: databaseNext },
                      (value) => {
                        setDatabases((old) => [
                          ...old,
                          ...value.items.filter(
                            (item) =>
                              !old.some(
                                (existing) => existing.name === item.name,
                              ),
                          ),
                        ]);
                        setDatabaseNext(value.next);
                      },
                    )
                  }
                >
                  加载更多库
                </button>
              )}
              <label>Schema</label>
              {schemas.length > 0 ? (
                <SelectMenu
                  label="Schema"
                  value={schema}
                  options={schemas.map((item) => ({
                    value: item.name,
                    label: item.name,
                  }))}
                  variant="field"
                  onChange={(value) => {
                    setSchema(value);
                    loadTables(database, value);
                  }}
                  disabled={loading}
                />
              ) : (
                !loading && <span className="muted">无可访问Schema</span>
              )}
              {schemaNext && (
                <button
                  className="text-button"
                  disabled={loading}
                  onClick={() =>
                    void request<Catalog>(
                      { view: "schemas", database, after: schemaNext },
                      (value) => {
                        setSchemas((old) => [...old, ...value.items]);
                        setSchemaNext(value.next);
                      },
                    )
                  }
                >
                  加载更多Schema
                </button>
              )}
            </div>
            <div className="pg-tree-title">
              <span>数据表</span>
              <span>{tables.length}</span>
            </div>
            <div className="input-search pg-tree-search">
              <Search size={15} />
              <input
                aria-label="筛选数据表"
                placeholder="筛选数据表"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="pg-object-list">
              {tables
                .filter((item) =>
                  item.name.toLowerCase().includes(filter.toLowerCase()),
                )
                .map((item) => (
                  <button
                    key={item.name}
                    className={table === item.name ? "selected" : ""}
                    onClick={() => {
                      setTab("data");
                      selectTable(item.name);
                    }}
                  >
                    <Table2 size={16} />
                    <span>{item.name}</span>
                  </button>
                ))}
              {!loading && tables.length === 0 && (
                <div className="pg-tree-empty">没有可读取的数据表</div>
              )}
              {tableNext && (
                <button
                  className="text-button"
                  disabled={loading}
                  onClick={() => loadTables(database, schema, tableNext)}
                >
                  加载更多表
                </button>
              )}
            </div>
          </aside>
          <section
            className="pg-preview"
            aria-label="表数据与结构"
            aria-busy={loading}
          >
            {error && (
              <div className="notice error" role="alert">
                {error}
                {pending.current && (
                  <button
                    className="text-button"
                    onClick={() => setVerifying(true)}
                  >
                    验证身份
                  </button>
                )}
              </div>
            )}
            {table ? (
              <>
                <div className="pg-preview-heading">
                  <div className="pg-table-icon">
                    <Table2 size={21} />
                  </div>
                  <div>
                    <div className="pg-breadcrumb">
                      {database} / {schema}
                    </div>
                    <h2>{table}</h2>
                  </div>
                  <span className="pg-readonly">只读</span>
                  <button
                    className="icon-button"
                    aria-label="刷新当前表"
                    disabled={loading}
                    onClick={() => selectTable(table, preview?.offset || 0)}
                  >
                    <RefreshCw size={16} className={loading ? "spin" : ""} />
                  </button>
                </div>
                <div className="pg-tabs">
                  <button
                    aria-pressed={tab === "data"}
                    onClick={() => setTab("data")}
                  >
                    <Table2 size={15} />
                    数据
                  </button>
                  <button
                    aria-pressed={tab === "structure"}
                    onClick={() => setTab("structure")}
                  >
                    <Columns3 size={15} />
                    结构{preview && <span>{preview.columns.length}</span>}
                  </button>
                </div>
                {loading ? (
                  <div className="pg-preview-empty">
                    <RefreshCw size={24} className="spin" />
                    <span>正在读取…</span>
                  </div>
                ) : (
                  preview &&
                  (tab === "structure" ? (
                    <div className="pg-table-scroll">
                      <table className="pg-data-table">
                        <thead>
                          <tr>
                            <th>字段</th>
                            <th>类型</th>
                            <th>可为空</th>
                            <th>主键</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.columns.map((column) => (
                            <tr key={column.name}>
                              <td>
                                <span className="pg-column-name">
                                  {column.redacted && <LockKeyhole size={13} />}
                                  {column.name}
                                </span>
                              </td>
                              <td className="mono">{column.type}</td>
                              <td>{column.nullable ? "是" : "否"}</td>
                              <td>{column.primary_key ? "是" : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : preview.note ? (
                    <div className="pg-preview-empty">
                      <LockKeyhole size={25} />
                      <span>{preview.note}</span>
                    </div>
                  ) : preview.rows.length ? (
                    <div className="pg-table-scroll">
                      <table className="pg-data-table">
                        <thead>
                          <tr>
                            {preview.displayed_columns?.map((name) => (
                              <th key={name}>{name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((row, index) => (
                            <tr key={index}>
                              {preview.displayed_columns?.map((name) => (
                                <td key={name} title={row[name] ?? "NULL"}>
                                  {row[name] === null ? (
                                    <span className="pg-null">NULL</span>
                                  ) : (
                                    row[name]
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="pg-preview-empty">
                      <Table2 size={25} />
                      <span>暂无数据</span>
                    </div>
                  ))
                )}
                {preview && tab === "data" && !preview.note && (
                  <div className="pg-data-footer">
                    <span>
                      {preview.rows.length
                        ? `第 ${preview.offset + 1}–${preview.offset + preview.rows.length} 行`
                        : "0 行"}
                    </span>
                    <div>
                      <button
                        className="button secondary small"
                        disabled={loading || preview.offset === 0}
                        onClick={() => selectTable(table, preview.offset - 25)}
                      >
                        上一页
                      </button>
                      <button
                        className="button secondary small"
                        disabled={loading || !preview.has_more}
                        onClick={() => selectTable(table, preview.offset + 25)}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="pg-preview-empty">
                <span className="pg-table-icon">
                  <Table2 size={26} />
                </span>
                <h2>{loading ? "正在读取…" : "选择数据表"}</h2>
              </div>
            )}
          </section>
        </div>
      )}
      {verifying && (
        <ConnectionVerification
          session={session}
          onClose={() => setVerifying(false)}
          onVerified={() => {
            setVerifying(false);
            setError("");
            const retry = pending.current;
            pending.current = null;
            retry?.();
          }}
        />
      )}
    </>
  );
}
