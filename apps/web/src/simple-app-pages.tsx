import { useState } from "react";
import { requestId } from "./request-id";
import {
  add,
  amountIn,
  annual,
  categories,
  day,
  decimal,
  encode,
  labels,
  move,
  negate,
  object,
  patchRow,
  performance,
  ratio,
  rows,
  sum,
  text,
  totals,
  validateRow,
  type Category,
  type Page,
  type Row,
} from "./simple-app-model";
type Props = {
  ledger: Row;
  page: Page;
  context: Row;
  patch: (ledger: Row) => void;
  go: (page: Page, context?: Row) => void;
};
const show = (value: string | null) => (value === null ? "未知" : value);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const currencyOptions = [
  "CNY",
  "HKD",
  "USD",
  "JPY",
  "KRW",
  "SGD",
  "GBP",
  "EUR",
  "AUD",
  "CAD",
  "INR",
  "TWD",
  "BRL",
];
const markets = [
  "US",
  "HK",
  "CN",
  "JP",
  "KR",
  "SG",
  "UK",
  "DE",
  "FR",
  "AU",
  "CA",
  "IN",
  "TW",
  "BR",
];
function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">未登记</option>
        {[...new Set([...options, ...(value ? [value] : [])])].map((v) => (
          <option key={v} value={v}>
            {(
              {
                month: "每月",
                quarter: "每季度",
                year: "每年",
                once: "一次",
                monthly: "每月（原记录）",
                yearly: "每年（原记录）",
                week: "每周（原记录）",
                day: "每天（原记录）",
                stable: "固定支出",
                flexible: "弹性支出",
                other: "其他支出",
                value: "登记估值",
                "period-pnl": "登记期间损益",
                mwr: "资金加权期间收益率",
              } as Record<string, string>
            )[v] || v}
          </option>
        ))}
      </select>
    </label>
  );
}
function Metrics({
  values,
  currency,
  hidden = false,
}: {
  values: Record<string, string | null>;
  currency: string;
  hidden?: boolean;
}) {
  return (
    <>
      <p className="simple-value-basis">本人登记与估算 · 非券商已核余额</p>
      <dl className="simple-metrics">
        {Object.entries(values).map(([key, value]) => (
          <div key={key}>
            <dt>
              {(
                {
                  assets: "总资产",
                  net: "净资产",
                  cash: "流动资金",
                  fixed: "固定资产",
                  receivable: "应收款",
                  debt: "负债",
                  invest: "投资理财",
                  pnl: "登记累计收益",
                  income: "预估年度收入",
                  expenses: "预估年度支出",
                  surplus: "预估年度结余",
                } as Record<string, string>
              )[key] || key}
            </dt>
            <dd>
              {hidden ? "••••" : show(value)} {currency}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
export function SimplePages(props: Props) {
  return <PageBody key={props.page + ":" + encode(props.context)} {...props} />;
}
function PageBody({ ledger, page, context, patch, go }: Props) {
  const currency = text(ledger.displayCur),
    t = totals(ledger, currency);
  const [member, setMember] = useState(""),
    [filter, setFilter] = useState(""),
    [archived, setArchived] = useState(false),
    [error, setError] = useState("");
  const category = (
    categories.includes(text(context.cat) as Category)
      ? text(context.cat)
      : "cash"
  ) as Category;
  const investment = rows(ledger.invest).find(
    (row) => text(row.id) === text(context.account),
  );
  const update = (row: Row, cat: Category) => {
    try {
      patch(patchRow(ledger, cat, row));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "记录无法更新");
      return false;
    }
  };
  const remove = (row: Row, cat: Category) => {
    if (!text(row.id)) {
      setError("原记录缺少编号，请在高级原件工具核对，不能猜测");
      return;
    }
    if (
      window.confirm(
        `从独立账本草稿删除“${text(row.name)}”？请下载当前JSON留档。`,
      )
    )
      patch({
        ...ledger,
        [cat]: rows(ledger[cat]).filter((r) => text(r.id) !== text(row.id)),
      });
  };
  const order = (cat: Category, index: number, direction: number) =>
    patch({ ...ledger, [cat]: move(rows(ledger[cat]), index, direction) });
  function cards(cat: Category, list = rows(ledger[cat])) {
    return (
      <div className="simple-cards">
        {list.map((row, i) => (
          <article key={text(row.id) || "unidentified-" + i}>
            <h4>{text(row.name) || "未命名"}</h4>
            <p>
              {ledger.hide ? "••••" : text(row.amount) || "金额未知"}{" "}
              {text(row.cur) || "币种未知"} · {text(row.owner) || "成员未登记"}
            </p>
            {cat === "invest" && (
              <p>
                {text(row.bucket) || "类别未登记"} ·{" "}
                {text(row.market) || "市场未登记"} ·{" "}
                {row.archived === true ? "已归档" : "当前账户"}
              </p>
            )}
            <button
              onClick={() =>
                go(
                  cat === "invest" ? "account" : "editItem",
                  cat === "invest"
                    ? { account: row.id ?? "" }
                    : { cat, itemId: row.id ?? "" },
                )
              }
            >
              查看与编辑
            </button>
            <button disabled={!text(row.id)} onClick={() => remove(row, cat)}>
              删除草稿项
            </button>
          </article>
        ))}
      </div>
    );
  }
  if (page === "addItem" || page === "editItem" || page === "addInvest") {
    const cat = page === "addInvest" ? "invest" : category,
      original = rows(ledger[cat]).find(
        (r) => text(r.id) === text(context.itemId),
      );
    return (
      <RowEditor
        key={text(context.itemId)}
        original={original}
        category={cat}
        members={rows(ledger.members)}
        onSave={(row) => {
          const invalid = validateRow(row, cat === "invest", original);
          if (invalid) {
            setError(invalid);
            return;
          }
          if (!update(row, cat)) return;
          go(
            cat === "invest" ? "account" : "update",
            cat === "invest" ? { account: row.id ?? "" } : { cat },
          );
        }}
        error={error}
      />
    );
  }
  if (page === "home")
    return (
      <>
        <h3>独立账本总览</h3>
        <Metrics values={t} currency={currency} hidden={ledger.hide === true} />
        <details>
          <summary>估算范围与精度</summary>
          <p>
            按本人登记汇率折算的估算值，非终止除法按18位有效数字四舍五入，可能舍入；原金额及汇率不改。缺币种、金额或正汇率时未知，不是券商已核到账值。
          </p>
        </details>
        <button
          onClick={() => patch({ ...ledger, hide: ledger.hide !== true })}
        >
          {ledger.hide ? "显示金额" : "隐藏金额"}
        </button>
        <button onClick={() => go("update")}>更新家庭资产</button>
        <button onClick={() => go("invest")}>投资记账</button>
        <button onClick={() => go("cashflow")}>规划年度收支</button>
      </>
    );
  if (page === "weather") {
    const debtRatio = ratio(negate(t.debt), t.assets),
      cf = object(ledger.cashflow),
      expense = sum(rows(cf.expenseItems).map(annual)),
      monthly = ratio(expense, "12"),
      buffer = text(cf.currency) === currency ? ratio(t.cash, monthly) : null;
    return (
      <>
        <h3>财务晴雨表</h3>
        <p>本人登记的资产、负债和预算观察，不构成评级或融资权限。</p>
        <Metrics
          currency={currency}
          values={{
            net: t.net,
            "负债占资产比例（约，12位小数）": debtRatio,
            "现金覆盖预估月支出（月，约）": buffer,
          }}
        />
        <p>
          缺少完整登记时保持未知，不使用默认月支出。预算金额币种须与展示币种一致；旧预算未声明币种时仅展示其原登记值。
        </p>
      </>
    );
  }
  if (page === "manage") return <Members ledger={ledger} patch={patch} />;
  if (page === "update")
    return (
      <>
        <h3>更新家庭资产</h3>
        <nav>
          {categories.map((cat) => (
            <button key={cat} onClick={() => go("update", { cat })}>
              {labels[cat]}
            </button>
          ))}
        </nav>
        <h4>{labels[category]}</h4>
        <button
          onClick={() =>
            go(category === "invest" ? "addInvest" : "addItem", {
              cat: category,
            })
          }
        >
          添加{labels[category]}
        </button>
        {cards(category)}
        {rows(ledger[category]).map((row, i) => (
          <div key={text(row.id) || i}>
            {text(row.name)}
            <button disabled={i === 0} onClick={() => order(category, i, -1)}>
              上移
            </button>
            <button
              disabled={i === rows(ledger[category]).length - 1}
              onClick={() => order(category, i, 1)}
            >
              下移
            </button>
          </div>
        ))}
      </>
    );
  if (page === "help")
    return (
      <>
        <h3>类别与计算说明</h3>
        {categories.map((cat) => (
          <article key={cat}>
            <h4>{labels[cat]}</h4>
            <p>
              {
                (
                  {
                    cash: "可随时使用的本人登记资金；不等同真实现金账本余额。",
                    fixed: "房产、车辆等不易变现资产，以本人明确登记金额为准。",
                    receivable: "应收借款、押金、待退款，不自动当成可用现金。",
                    debt: "负债以本人明确的负金额保存，添加时需确认方向。",
                    invest: "独立投资账户估值与资金流观察，不创建股票成交。",
                  } as Record<Category, string>
                )[cat]
              }
            </p>
            <button onClick={() => go("update", { cat })}>查看与维护</button>
          </article>
        ))}
        <p>
          预期年化是本人规划输入；不会作为观察收益。缺失历史、初始资金流或币种不补零，不从当前仓位反推曲线。
        </p>
      </>
    );
  if (page === "cashflow") return <Cashflow ledger={ledger} patch={patch} />;
  if (page === "family")
    return (
      <>
        <h3>家庭资产与历史</h3>
        <Choice
          label="成员"
          value={member}
          options={rows(ledger.members)
            .filter((r) => r.show !== false)
            .map((r) => text(r.name))
            .filter(Boolean)}
          onChange={setMember}
        />
        <Metrics
          currency={currency}
          values={totals(ledger, currency, member)}
          hidden={ledger.hide === true}
        />
        <p>成员历史快照若未标归属不与当前成员资产混合。</p>
        <History
          rows={rows(ledger.snaps).filter(
            (r) => !member || text(r.owner) === member,
          )}
          dateField="at"
          valueField="assets"
          knownCurrency={currency}
          label="已登记家庭资产快照"
        />
        <Snapshot ledger={ledger} patch={patch} />
      </>
    );
  if (page === "calendar") return <Calendar ledger={ledger} />;
  if (page === "invest") {
    const visible = rows(ledger.invest).filter(
      (row) =>
        (row.archived === true) === archived &&
        (!filter || text(row.bucket) === filter) &&
        (!text(context.group) || text(row.group) === text(context.group)),
    );
    return (
      <>
        <h3>投资记账</h3>
        <Choice
          label="账本组"
          value={text(context.group)}
          options={[
            ...new Set(
              rows(ledger.invest)
                .map((r) => text(r.group))
                .filter(Boolean),
            ),
          ]}
          onChange={(group) => go("invest", { group })}
        />
        <Choice
          label="投资分类"
          value={filter}
          options={["活钱", "稳健", "长期"]}
          onChange={setFilter}
        />
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          查看已归档账户
        </label>
        <button onClick={() => go("addInvest")}>添加投资账户</button>
        <button onClick={() => go("addSummary")}>创建自定义汇总</button>
        {cards("invest", visible)}
        {rows(ledger.invest).map((row, i) => (
          <div key={text(row.id) || i}>
            {text(row.name)}
            <button disabled={i === 0} onClick={() => order("invest", i, -1)}>
              上移
            </button>
            <button
              disabled={i === rows(ledger.invest).length - 1}
              onClick={() => order("invest", i, 1)}
            >
              下移
            </button>
          </div>
        ))}
      </>
    );
  }
  if (page === "addSummary")
    return <SummaryEditor ledger={ledger} patch={patch} go={go} />;
  if (page === "summary") {
    const sourceComplete =
      Array.isArray(ledger.invest) &&
      rows(ledger.invest).length === ledger.invest.length;
    const selected = rows(ledger.summaries).find(
        (row) => text(row.id) === text(context.summaryId),
      ),
      ids = Array.isArray(selected?.ids) ? selected.ids.map(text) : null,
      list = rows(ledger.invest).filter(
        (r) => r.archived !== true && (!ids || ids.includes(text(r.id))),
      );
    return (
      <>
        <h3>{selected ? text(selected.name) : "全部投资汇总"}</h3>
        <Metrics
          currency={currency}
          values={{
            invest: sourceComplete
              ? sum(list.map((r) => amountIn(r, ledger, currency)))
              : null,
            pnl: sourceComplete
              ? sum(
                  list.map((r) =>
                    amountIn(
                      {
                        ...r,
                        amount: add(
                          decimal(r.amount),
                          negate(
                            add(decimal(r.inAmt), negate(decimal(r.outAmt))),
                          ),
                        ),
                      },
                      ledger,
                      currency,
                    ),
                  ),
                )
              : null,
          }}
        />
        <p>
          登记累计收益需要明确累计投入和转出；未知不补零。跨账户收益率不从当前估值合成。
        </p>
        {rows(ledger.summaries).map((row) => (
          <article key={text(row.id)}>
            <button onClick={() => go("summary", { summaryId: row.id ?? "" })}>
              {text(row.name)}
            </button>
            <button
              onClick={() => {
                if (window.confirm("删除该汇总？保留原投资账户。"))
                  patch({
                    ...ledger,
                    summaries: rows(ledger.summaries).filter(
                      (r) => text(r.id) !== text(row.id),
                    ),
                  });
              }}
            >
              删除汇总
            </button>
          </article>
        ))}
        <button onClick={() => go("addSummary")}>新建汇总</button>
        {cards("invest", list)}
      </>
    );
  }
  if (page === "account") {
    if (!investment) return <p>未找到稳定编号对应的投资账户；不按名称猜测。</p>;
    const pnl = add(
      decimal(investment.amount),
      negate(
        add(decimal(investment.inAmt), negate(decimal(investment.outAmt))),
      ),
    );
    return (
      <>
        <h3>{text(investment.name)}</h3>
        <p>
          {text(investment.market) || "市场未知"} ·{" "}
          {text(investment.cur) || "币种未知"} · {text(investment.bucket)}
        </p>
        <Metrics
          currency={text(investment.cur)}
          values={{ invest: decimal(investment.amount), pnl }}
        />
        <Returns ledger={ledger} row={investment} patch={patch} />
        <button
          onClick={() => go("settings", { account: investment.id ?? "" })}
        >
          账户设置
        </button>
        <button
          onClick={() => {
            void navigator.clipboard
              ?.writeText(
                `${text(investment.name)}\n${text(investment.amount) || "未知"} ${text(investment.cur)}\n登记收益 ${show(pnl)}`,
              )
              .catch(() => setError("复制不可用，请手动选择摘要"));
          }}
        >
          复制登记摘要
        </button>
        <History
          rows={rows(investment.hist)}
          dateField="d"
          valueField="v"
          complete={
            investment.historyComplete === true &&
            Array.isArray(investment.hist) &&
            rows(investment.hist).length === investment.hist.length
          }
          label="投资原始观察"
        />
        <InvestmentObservation ledger={ledger} row={investment} patch={patch} />
        {error && <p role="alert">{error}</p>}
      </>
    );
  }
  if (page === "settings") {
    if (investment)
      return (
        <>
          <RowEditor
            original={investment}
            category="invest"
            members={rows(ledger.members)}
            onSave={(row) => {
              const invalid = validateRow(row, true, investment);
              if (invalid) {
                setError(invalid);
                return;
              }
              if (!update(row, "invest")) return;
              go("account", { account: row.id ?? "" });
            }}
            error={error}
          />
          <button
            onClick={() =>
              update(
                { ...investment, archived: investment.archived !== true },
                "invest",
              )
            }
          >
            {investment.archived ? "恢复账户" : "归档账户"}
          </button>
          <button onClick={() => remove(investment, "invest")}>
            删除草稿账户
          </button>
          <p>
            账户所属账本组：{text(investment.group) || "未登记"}
            ；文件工具在页面下方，可将所选候选加入明确账本组，不覆盖旧历史。
          </p>
        </>
      );
    return <Settings ledger={ledger} patch={patch} />;
  }
  return null;
}
function RowEditor({
  original,
  category,
  members,
  onSave,
  error,
}: {
  original?: Row;
  category: Category;
  members: Row[];
  onSave: (row: Row) => void;
  error: string;
}) {
  const [draft, setDraft] = useState<Row>(
    original
      ? { ...original }
      : {
          id: requestId(),
          name: "",
          amount: "",
          cur: "",
          owner: "",
          ...(category === "invest" ? { bucket: "", market: "" } : {}),
        },
  );
  const [local, setLocal] = useState("");
  const field = (key: string, label: string) => (
    <Field
      key={key}
      label={label}
      value={text(draft[key])}
      onChange={(value) => setDraft({ ...draft, [key]: value })}
    />
  );
  return (
    <section>
      <h3>
        {original ? "编辑" : "添加"}
        {labels[category]}
      </h3>
      {field("name", "名称")}
      {field(
        "amount",
        category === "debt" ? "负债金额（明确输入负值）" : "登记金额（精确值）",
      )}
      <Choice
        label="原币"
        value={text(draft.cur)}
        options={currencyOptions}
        onChange={(value) => setDraft({ ...draft, cur: value })}
      />
      <Choice
        label="成员"
        value={text(draft.owner)}
        options={members.map((m) => text(m.name)).filter(Boolean)}
        onChange={(value) => setDraft({ ...draft, owner: value })}
      />
      {category === "invest" && (
        <>
          <Choice
            label="市场（不自动推断币种）"
            value={text(draft.market)}
            options={markets}
            onChange={(value) => setDraft({ ...draft, market: value })}
          />
          <Choice
            label="投资分类"
            value={text(draft.bucket)}
            options={["活钱", "稳健", "长期"]}
            onChange={(value) => setDraft({ ...draft, bucket: value })}
          />
          {field("group", "账本组")}
          {field("inAmt", "累计投入（未知留空）")}
          {field("outAmt", "累计转出（未知留空）")}
          {field("expected", "预期年化 %（规划值）")}
        </>
      )}
      {field("date", "登记日期（原值保留；修改请用YYYY-MM-DD）")}
      {field("note", "备注")}
      <p>
        未编辑的额外字段和历史原样保留。金额修改不自动生成历史观察或资金流。
      </p>
      {(error || local) && <p role="alert">{error || local}</p>}
      <button
        onClick={() => {
          if (!text(draft.id)) {
            setLocal("原记录缺少稳定编号，不能猜测目标");
            return;
          }
          const invalid = validateRow(draft, category === "invest", original);
          if (invalid) {
            setLocal(invalid);
            return;
          }
          if (
            category === "debt" &&
            (!original ||
              encode(draft.amount ?? null) !==
                encode(original.amount ?? null)) &&
            !decimal(draft.amount)?.startsWith("-") &&
            decimal(draft.amount) !== "0"
          ) {
            setLocal("负债须明确输入负值，不自动改符号");
            return;
          }
          if (
            (!original ||
              encode(draft.date ?? null) !== encode(original.date ?? null)) &&
            text(draft.date) &&
            !day(text(draft.date))
          ) {
            setLocal("日期无效");
            return;
          }
          for (const key of ["inAmt", "outAmt", "expected"])
            if (
              (!original ||
                encode(draft[key] ?? null) !== encode(original[key] ?? null)) &&
              text(draft[key]) &&
              decimal(draft[key]) === null
            ) {
              setLocal("金额或预期格式无效");
              return;
            }
          onSave(draft);
        }}
      >
        将此记录更新到草稿
      </button>
    </section>
  );
}
function Members({ ledger, patch }: { ledger: Row; patch: Props["patch"] }) {
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  return (
    <section>
      <h3>家庭成员</h3>
      {rows(ledger.members).map((row, i) => (
        <article key={text(row.id) || i}>
          <Field
            label="成员名称"
            value={text(row.name)}
            onChange={(value) => {
              const old = text(row.name);
              const changed = categories.some((cat) =>
                rows(ledger[cat]).some((r) => text(r.owner) === old),
              );
              if (changed) {
                setError(
                  "此成员已有关联资产；请先在资产表单明确调整归属，再更改名称，避免隐式更名历史",
                );
                return;
              }
              patch({
                ...ledger,
                members: rows(ledger.members).map((r, j) =>
                  j === i ? { ...r, name: value } : r,
                ),
              });
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={row.show !== false}
              onChange={(e) =>
                patch({
                  ...ledger,
                  members: rows(ledger.members).map((r, j) =>
                    i === j ? { ...r, show: e.target.checked } : r,
                  ),
                })
              }
            />
            在家庭成员筛选中显示
          </label>
          <button
            disabled={i === 0}
            onClick={() =>
              patch({ ...ledger, members: move(rows(ledger.members), i, -1) })
            }
          >
            上移成员
          </button>
          <button
            onClick={() => {
              if (
                categories.some((cat) =>
                  rows(ledger[cat]).some(
                    (r) => text(r.owner) === text(row.name),
                  ),
                )
              ) {
                setError("成员仍有关联资产，不能静默移除归属");
                return;
              }
              if (rows(ledger.members).length <= 1) {
                setError("至少保留一名明确成员");
                return;
              }
              patch({
                ...ledger,
                members: rows(ledger.members).filter((_, j) => i !== j),
              });
            }}
          >
            移除成员
          </button>
        </article>
      ))}
      <Field label="新成员名称" value={name} onChange={setName} />
      <button
        onClick={() => {
          if (
            !name.trim() ||
            rows(ledger.members).some((r) => text(r.name) === name.trim())
          ) {
            setError("请填写不重复名称");
            return;
          }
          patch({
            ...ledger,
            members: [
              ...rows(ledger.members),
              { id: requestId(), name: name.trim(), show: true },
            ],
          });
          setName("");
        }}
      >
        加入草稿
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function Settings({ ledger, patch }: { ledger: Row; patch: Props["patch"] }) {
  const fx = object(ledger.fx);
  const [currency, setCurrency] = useState(""),
    [rate, setRate] = useState(""),
    [error, setError] = useState("");
  return (
    <section>
      <h3>独立账本设置</h3>
      <Choice
        label="展示币种"
        value={text(ledger.displayCur)}
        options={currencyOptions}
        onChange={(displayCur) => patch({ ...ledger, displayCur })}
      />
      <label>
        <input
          type="checkbox"
          checked={ledger.excludeFixed === true}
          onChange={(e) => patch({ ...ledger, excludeFixed: e.target.checked })}
        />
        统计时排除固定资产（当前分类明细仍保留）
      </label>
      <Field
        label="默认预期年化（本人规划 %）"
        value={text(ledger.expected)}
        onChange={(expected) => {
          if (expected !== "" && decimal(expected) === null) {
            setError("格式无效");
            return;
          }
          patch({ ...ledger, expected });
        }}
      />
      <Field
        label="每月记账提醒日（0关闭，1–28；仅保存偏好，不声明已投递通知）"
        value={text(ledger.reminder)}
        onChange={(reminder) => {
          if (reminder && (!/^\d+$/.test(reminder) || Number(reminder) > 28))
            return;
          patch({ ...ledger, reminder });
        }}
      />
      <h4>本人登记汇率（每单位币种对应CNY）</h4>
      {Object.entries(fx).map(([key, value]) => (
        <Field
          key={key}
          label={key}
          value={text(value)}
          onChange={(next) => {
            if (next && decimal(next) === null) {
              setError("汇率格式无效");
              return;
            }
            patch({ ...ledger, fx: { ...fx, [key]: next } });
          }}
        />
      ))}
      <Choice
        label="添加汇率币种"
        value={currency}
        options={currencyOptions}
        onChange={setCurrency}
      />
      <Field label="明确汇率" value={rate} onChange={setRate} />
      <button
        onClick={() => {
          if (
            !currency ||
            decimal(rate) === null ||
            decimal(rate) === "0" ||
            decimal(rate)?.startsWith("-")
          ) {
            setError("请填正汇率，不使用默认值");
            return;
          }
          patch({ ...ledger, fx: { ...fx, [currency]: rate } });
          setRate("");
        }}
      >
        登记到草稿
      </button>
      <p>
        这些是独立登记值，不替代公开市场汇率来源。旧默认汇率不宣称已观察；使用前应由本人明确核对。
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function SummaryEditor({
  ledger,
  patch,
  go,
}: {
  ledger: Row;
  patch: Props["patch"];
  go: Props["go"];
}) {
  const [name, setName] = useState(""),
    [ids, setIds] = useState<string[]>([]);
  return (
    <section>
      <h3>创建自定义投资汇总</h3>
      <Field label="汇总名称" value={name} onChange={setName} />
      {rows(ledger.invest).map((r, i) => (
        <label key={text(r.id) || i}>
          <input
            type="checkbox"
            disabled={!text(r.id)}
            checked={ids.includes(text(r.id))}
            onChange={(e) =>
              setIds(
                e.target.checked
                  ? [...ids, text(r.id)]
                  : ids.filter((id) => id !== text(r.id)),
              )
            }
          />
          {text(r.name)} · {text(r.cur) || "币种未知"}
        </label>
      ))}
      <button
        disabled={!name.trim() || !ids.length}
        onClick={() => {
          const id = requestId();
          patch({
            ...ledger,
            summaries: [
              ...rows(ledger.summaries),
              { id, name: name.trim(), ids },
            ],
          });
          go("summary", { summaryId: id });
        }}
      >
        加入草稿
      </button>
    </section>
  );
}
function History({
  rows: list,
  dateField,
  valueField,
  label,
  knownCurrency,
  complete = false,
}: {
  rows: Row[];
  dateField: string;
  valueField: string;
  label: string;
  knownCurrency?: string;
  complete?: boolean;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [mode, setMode] = useState("value");
  const filtered = list
    .filter(
      (r) =>
        (!from || text(r[dateField]) >= from) &&
        (!to || text(r[dateField]) <= to),
    )
    .sort((a, b) => text(a[dateField]).localeCompare(text(b[dateField])));
  const rawFor = (r: Row, i: number): string | null => {
    if (text(r[dateField]).slice(0, 10) > today()) return null;
    if (knownCurrency && text(r.currency) !== knownCurrency) return null;
    if (mode === "value") return decimal(r[valueField]);
    if (mode === "mwr")
      return performance(filtered.slice(0, i + 1), complete, today()).period;
    const start = decimal(filtered[0]?.[valueField]),
      flows = filtered.slice(1, i + 1);
    return add(
      add(decimal(r[valueField]), negate(start)),
      add(
        negate(sum(flows.map((v) => decimal(v.inn)))),
        sum(flows.map((v) => decimal(v.out))),
      ),
    );
  };
  const points = filtered.map((r, i) => ({
    at: text(r[dateField]),
    raw: rawFor(r, i),
    index: i,
    time: Date.parse(text(r[dateField])),
  }));
  const finite = points.filter(
      (p) =>
        p.raw !== null &&
        Number.isFinite(Number(p.raw)) &&
        Number.isFinite(p.time),
    ),
    nums = finite.map((p) => Number(p.raw)),
    min = Math.min(...nums),
    max = Math.max(...nums),
    start =
      from && Number.isFinite(Date.parse(from))
        ? Date.parse(from)
        : Math.min(...finite.map((p) => p.time)),
    end =
      to && Number.isFinite(Date.parse(to))
        ? Date.parse(to)
        : Math.max(...finite.map((p) => p.time));
  return (
    <section>
      <h4>{label}</h4>
      {dateField === "d" && (
        <Choice
          label="图表口径"
          value={mode}
          options={["value", "period-pnl", "mwr"]}
          onChange={setMode}
        />
      )}
      <div className="module-actions">
        <button
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          全部已登记范围
        </button>
        <button
          onClick={() => {
            setFrom(today().slice(0, 4) + "-01-01");
            setTo(today());
          }}
        >
          本年（1月1日起）
        </button>
      </div>
      <p>
        value：原估值；period-pnl：相对范围首个观察、扣明确资金流的期间损益；mwr：明确完整记录的资金加权期间收益率（近似）。缺观察不拉伸范围。
      </p>
      <Field label="开始日期" value={from} type="date" onChange={setFrom} />
      <Field label="结束日期" value={to} type="date" onChange={setTo} />
      <p>
        仅绘已登记观察，空值断开；未补交易日、未来估值或期初。横轴为实际日期间隔；纵轴为展示近似，表格保精确原值。家庭快照缺币种或币种不同时仅保留原表，不混合绘图。
      </p>
      {finite.length > 0 && (
        <svg
          role="img"
          aria-label={label}
          viewBox="0 0 600 160"
          className="simple-history-chart"
        >
          {points.map((p, i) => {
            const prior = points[i - 1];
            if (
              !prior ||
              p.raw === null ||
              prior.raw === null ||
              !Number.isFinite(Number(p.raw)) ||
              !Number.isFinite(Number(prior.raw)) ||
              !Number.isFinite(p.time) ||
              !Number.isFinite(prior.time)
            )
              return null;
            const x = (index: number) =>
              20 +
              ((points[index].time - start) / Math.max(1, end - start)) * 560;
            const y = (raw: string) =>
              max === min
                ? 80
                : 140 - ((Number(raw) - min) / (max - min)) * 120;
            return (
              <line
                key={i}
                x1={x(i - 1)}
                x2={x(i)}
                y1={y(prior.raw)}
                y2={y(p.raw)}
                stroke="currentColor"
                strokeWidth="2"
              />
            );
          })}
        </svg>
      )}
      <div className="workspace-table">
        <table>
          <thead>
            <tr>
              <th>原日期</th>
              <th>原登记值</th>
              <th>图表值</th>
              <th>投入</th>
              <th>转出</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td>
                  {text(r[dateField]) || "未登记"}
                  {text(r[dateField]).slice(0, 10) > today()
                    ? "（未来登记/规划）"
                    : ""}
                </td>
                <td>{text(r[valueField]) || "未知"}</td>
                <td>
                  {show(rawFor(r, i))}
                  {mode === "mwr" ? " %" : ""}
                </td>
                <td>{text(r.inn) || "未知"}</td>
                <td>{text(r.out) || "未知"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p>此范围没有已登记观察。</p>}
    </section>
  );
}
function InvestmentObservation({
  ledger,
  row,
  patch,
}: {
  ledger: Row;
  row: Row;
  patch: Props["patch"];
}) {
  const [date, setDate] = useState(""),
    [value, setValue] = useState(""),
    [incoming, setIncoming] = useState(""),
    [outgoing, setOutgoing] = useState(""),
    [current, setCurrent] = useState(false),
    [error, setError] = useState("");
  return (
    <details>
      <summary>明确添加一次估值/资金流观察</summary>
      <Field
        label="观察日期（明确填写）"
        type="date"
        value={date}
        onChange={setDate}
      />
      <Field label="当日资产金额" value={value} onChange={setValue} />
      <Field
        label="当日投入（无投入需明确填0；未知留空）"
        value={incoming}
        onChange={setIncoming}
      />
      <Field
        label="当日转出（无转出需明确填0；未知留空）"
        value={outgoing}
        onChange={setOutgoing}
      />
      <label>
        <input
          type="checkbox"
          checked={current}
          onChange={(e) => setCurrent(e.target.checked)}
        />
        同时更新当前登记金额及已知累计投入/转出
      </label>
      <button
        onClick={() => {
          if (row.hist !== undefined && !Array.isArray(row.hist)) {
            setError("原历史不是可识别数组，不能覆盖；请先核对原件");
            return;
          }
          if (!day(date) || date > today() || decimal(value) === null) {
            setError("需真实有效观察日期及明确估值");
            return;
          }
          if (
            (incoming && decimal(incoming) === null) ||
            (outgoing && decimal(outgoing) === null)
          ) {
            setError("资金流格式无效");
            return;
          }
          const observation: Row = {
            d: date,
            v: value,
            inn: incoming || null,
            out: outgoing || null,
          };
          let next: Row = {
            ...row,
            historyComplete: false,
            hist: [...(Array.isArray(row.hist) ? row.hist : []), observation],
          };
          if (current)
            next = {
              ...next,
              amount: value,
              updated: date,
              inAmt: add(decimal(row.inAmt), decimal(incoming)),
              outAmt: add(decimal(row.outAmt), decimal(outgoing)),
            };
          patch(patchRow(ledger, "invest", next));
          setDate("");
          setValue("");
          setIncoming("");
          setOutgoing("");
          setError("");
        }}
      >
        将原观察加入草稿（不改旧记录）
      </button>
      <p>
        相同日期可有多次明确观察，按原顺序保留；不自动去重、修复或平移收益曲线。
      </p>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
function Snapshot({ ledger, patch }: { ledger: Row; patch: Props["patch"] }) {
  const [date, setDate] = useState(""),
    [ack, setAck] = useState(false),
    [error, setError] = useState("");
  const currency = text(ledger.displayCur),
    t = totals(ledger, currency);
  return (
    <details>
      <summary>保留当前家庭登记快照</summary>
      <Field
        label="本人核实观察日期"
        value={date}
        type="date"
        onChange={setDate}
      />
      <p>
        资产 {show(t.assets)} · 负债 {show(t.debt)} {currency}；未知项保持null。
      </p>
      <label>
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        此日期与当前全部登记值对应，明确作为本人观察
      </label>
      <button
        disabled={!ack}
        onClick={() => {
          if (!currency || !day(date) || date > today()) {
            setError("请填写有效非未来日期");
            return;
          }
          patch({
            ...ledger,
            snaps: [
              ...rows(ledger.snaps),
              {
                at: date,
                assets: t.assets,
                debt: t.debt,
                cash: t.cash,
                fixed: t.fixed,
                inv: t.invest,
                rec: t.receivable,
                currency,
                authority: "owner_declared_observation",
              },
            ],
          });
          setAck(false);
        }}
      >
        将快照加入草稿
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
function Calendar({ ledger }: { ledger: Row }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const events = [
    ...rows(ledger.snaps).map((r) => ({
      date: text(r.at),
      title: "家庭快照",
      amount: text(r.assets),
      currency: text(r.currency),
    })),
    ...rows(ledger.logs).map((r) => ({
      date: text(r.at) || text(r.date),
      title: text(r.name) || text(r.action) || "原登记日志",
      amount: text(r.amount),
      currency: text(r.cur),
    })),
    ...rows(ledger.invest).flatMap((a) =>
      rows(a.hist).map((r) => ({
        date: text(r.d),
        title: text(a.name),
        amount: text(r.v),
        currency: text(a.cur),
      })),
    ),
  ]
    .filter((e) => e.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section>
      <h3>记账日历</h3>
      <Field label="月份" type="month" value={month} onChange={setMonth} />
      {events.map((e, i) => (
        <article key={i}>
          <time>{e.date || "日期未知"}</time> · {e.title} ·{" "}
          {e.amount || "金额未知"} {e.currency || "币种未登记"}
        </article>
      ))}
      {!events.length && <p>本月没有已登记观察；不自动补记录。</p>}
    </section>
  );
}
function Cashflow({ ledger, patch }: { ledger: Row; patch: Props["patch"] }) {
  const cf = object(ledger.cashflow);
  const [step, setStep] = useState(
      cf.completed === true ? "overview" : "intro",
    ),
    [editing, setEditing] = useState<Row | null>(null),
    [kind, setKind] = useState<"income" | "expense">("income"),
    [error, setError] = useState("");
  const list = (k: string) =>
    rows(cf[k === "income" ? "incomeItems" : "expenseItems"]);
  const complete = (key: string) => {
    const value = cf[key];
    return Array.isArray(value) && rows(value).length === value.length;
  };
  const income =
      text(cf.currency).trim() &&
      list("income").length &&
      complete("incomeItems")
        ? sum(list("income").map(annual))
        : null,
    expense =
      text(cf.currency).trim() &&
      list("expense").length &&
      complete("expenseItems")
        ? sum(list("expense").map(annual))
        : null,
    surplus = add(income, negate(expense));
  const save = (next: Row) => patch({ ...ledger, cashflow: next });
  return (
    <section>
      <h3>年度现金流规划</h3>
      <Choice
        label="明确预算币种"
        value={text(cf.currency)}
        options={currencyOptions}
        onChange={(currency) => save({ ...cf, currency })}
      />
      <nav>
        {[
          ["intro", "开始"],
          ["income", "收入"],
          ["expense", "支出"],
          ["overview", "预算追踪"],
        ].map(([s, label]) => (
          <button
            key={s}
            onClick={() => {
              setStep(s);
              setEditing(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <Metrics
        currency={text(cf.currency).trim() || "币种未登记"}
        values={{ income, expenses: expense, surplus }}
      />
      <p>
        预算不等于实际收支或现金余额；币种与期间未登记的原数据不推断。旧版月度实际支出固定0并非观察，新页面保持未知。
      </p>
      {step === "intro" ? (
        <>
          <p>逐项登记金额和频率，再明确完成。未知频率不自动当年付。</p>
          <button
            onClick={() => {
              save({ ...cf, started: true });
              setStep("income");
            }}
          >
            开始规划
          </button>
        </>
      ) : step === "overview" ? (
        <>
          <FlowView income={income} expense={expense} />
          {list("expense").map((r, i) => (
            <article key={text(r.id) || i}>
              <strong>{text(r.name)}</strong>
              <p>
                年度预估 {show(annual(r))} · 实际月支出 未知 · 实际剩余 未知
              </p>
              <button
                onClick={() => {
                  setKind("expense");
                  setEditing(r);
                  setStep("expense");
                }}
              >
                编辑预算
              </button>
            </article>
          ))}
          <button onClick={() => save({ ...cf, completed: true })}>
            明确完成规划并加入草稿
          </button>
        </>
      ) : (
        <>
          {list(step).map((r, i) => (
            <article key={text(r.id) || i}>
              <h4>{text(r.name)}</h4>
              <p>
                {text(r.amount) || "未知"} / {text(r.freq) || "频率未知"} ·{" "}
                {text(r.type)}
              </p>
              <button
                onClick={() => {
                  setKind(step as "income" | "expense");
                  setEditing({ ...r });
                }}
              >
                编辑
              </button>
              <button
                onClick={() =>
                  save({
                    ...cf,
                    [step === "income" ? "incomeItems" : "expenseItems"]: list(
                      step,
                    ).filter((_, j) => i !== j),
                  })
                }
              >
                删除草稿项
              </button>
              <button
                disabled={i === 0}
                onClick={() =>
                  save({
                    ...cf,
                    [step === "income" ? "incomeItems" : "expenseItems"]: move(
                      list(step),
                      i,
                      -1,
                    ),
                  })
                }
              >
                上移
              </button>
            </article>
          ))}
          <button
            onClick={() => {
              setKind(step as "income" | "expense");
              setEditing({
                id: requestId(),
                name: "",
                amount: "",
                freq: "",
                kind: step,
                type: "",
              });
            }}
          >
            添加{step === "income" ? "收入" : "支出"}
          </button>
          <button
            onClick={() => setStep(step === "income" ? "expense" : "overview")}
          >
            下一步
          </button>
        </>
      )}
      {editing && (
        <article>
          <Field
            label="名称"
            value={text(editing.name)}
            onChange={(name) => setEditing({ ...editing, name })}
          />
          <Field
            label="每期预算金额"
            value={text(editing.amount)}
            onChange={(amount) => setEditing({ ...editing, amount })}
          />
          <Choice
            label="频率"
            value={text(editing.freq)}
            options={["month", "quarter", "year", "once"]}
            onChange={(freq) => setEditing({ ...editing, freq })}
          />
          {kind === "expense" && (
            <Choice
              label="支出类别"
              value={text(editing.type)}
              options={["stable", "flexible", "other"]}
              onChange={(type) => setEditing({ ...editing, type })}
            />
          )}
          <button
            onClick={() => {
              if (
                !text(editing.name).trim() ||
                decimal(editing.amount) === null ||
                decimal(editing.amount) === "0" ||
                decimal(editing.amount)!.startsWith("-") ||
                !["month", "quarter", "year", "once"].includes(
                  text(editing.freq),
                )
              ) {
                setError("请明确填写名称、金额和频率");
                return;
              }
              const key = kind === "income" ? "incomeItems" : "expenseItems",
                old = list(kind),
                id = text(editing.id);
              save({
                ...cf,
                started: true,
                [key]: old.some((r) => text(r.id) === id)
                  ? old.map((r) => (text(r.id) === id ? editing : r))
                  : [...old, editing],
              });
              setEditing(null);
              setError("");
            }}
          >
            加入预算草稿
          </button>
          <button onClick={() => setEditing(null)}>取消编辑</button>
        </article>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function FlowView({
  income,
  expense,
}: {
  income: string | null;
  expense: string | null;
}) {
  return (
    <figure>
      <svg role="img" aria-label="本人预算收支流向" viewBox="0 0 600 100">
        <rect
          x="15"
          y="15"
          width="170"
          height="65"
          fill="none"
          stroke="currentColor"
        />
        <path d="M185 48 H390" stroke="currentColor" strokeWidth="2" />
        <rect
          x="395"
          y="15"
          width="190"
          height="65"
          fill="none"
          stroke="currentColor"
        />
        <text x="30" y="52" fill="currentColor">
          预估收入 {show(income)}
        </text>
        <text x="410" y="52" fill="currentColor">
          预估支出 {show(expense)}
        </text>
      </svg>
      <figcaption>
        金额来自明确预算项；连接线不表示实际资金划转。可通过浏览器打印保留此图。
      </figcaption>
    </figure>
  );
}

function Returns({
  ledger,
  row,
  patch,
}: {
  ledger: Row;
  row: Row;
  patch: Props["patch"];
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const history = rows(row.hist).filter(
      (r) => (!from || text(r.d) >= from) && (!to || text(r.d) <= to),
    ),
    result = performance(
      history,
      row.historyComplete === true &&
        Array.isArray(row.hist) &&
        rows(row.hist).length === row.hist.length,
      today(),
    );
  return (
    <section>
      <h4>登记期间收益</h4>
      <Field label="收益范围开始" type="date" value={from} onChange={setFrom} />
      <Field label="收益范围结束" type="date" value={to} onChange={setTo} />
      <label>
        <input
          type="checkbox"
          checked={row.historyComplete === true}
          onChange={(e) =>
            patch(
              patchRow(ledger, "invest", {
                ...row,
                historyComplete: e.target.checked,
              }),
            )
          }
        />
        本人明确声明：此账户所有估值与资金流观察已完整登记（不是券商验证）
      </label>
      <p>{result.reason}</p>
      <dl>
        <dt>资金加权期间收益率（近似）</dt>
        <dd>{result.period === null ? "未知" : result.period + " %"}</dd>
        <dt>资金加权年化收益率（近似）</dt>
        <dd>{result.annual === null ? "未知" : result.annual + " %"}</dd>
      </dl>
      <p>
        {result.start} — {result.end}；预期年化 {text(row.expected) || "未登记"}{" "}
        % 为规划输入，不混入实际观察。
      </p>
    </section>
  );
}
