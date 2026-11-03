import { SelectMenu } from "./select-menu";
import {
  brokerCurrencies,
  brokerProviders,
  currencyRemovalBlocked,
  type BrokerAccount,
  type BrokerDraft,
} from "./broker-account-state";
export function BrokerAccountFields({
  draft,
  existing,
  disabled,
  onChange,
}: {
  draft: BrokerDraft;
  existing: BrokerAccount | null;
  disabled: boolean;
  onChange: (value: BrokerDraft) => void;
}) {
  return (
    <>
      <label>
        账户名称
        <input
          required
          maxLength={60}
          autoComplete="off"
          value={draft.name}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      {existing ? (
        <div>
          <span>
            {existing.account_kind === "real"
              ? "真实"
              : existing.account_kind === "simulated"
                ? "模拟"
                : "身份未核实"}
          </span>{" "}
          ·{" "}
          <span>
            {brokerProviders.find(
              (value) => value.value === existing.provider_id,
            )?.label ??
              existing.provider_id ??
              "未指定机构"}
          </span>
        </div>
      ) : (
        <>
          <label>
            账户类型
            <SelectMenu
              label="账户类型"
              variant="field"
              value={draft.account_kind}
              disabled={disabled}
              options={[
                { value: "", label: "选择账户类型" },
                { value: "real", label: "真实" },
                { value: "simulated", label: "模拟" },
              ]}
              onChange={(value) => onChange({ ...draft, account_kind: value })}
            />
          </label>
          <label>
            机构
            <SelectMenu
              label="机构"
              variant="field"
              value={draft.provider_id}
              disabled={disabled}
              options={brokerProviders}
              onChange={(value) => onChange({ ...draft, provider_id: value })}
            />
          </label>
        </>
      )}
      <label>
        默认币种
        <SelectMenu
          label="默认币种"
          variant="field"
          value={draft.currency}
          disabled={disabled}
          options={[
            { value: "", label: "选择默认币种" },
            ...brokerCurrencies.map((value) => ({ value, label: value })),
          ]}
          onChange={(value) =>
            onChange({
              ...draft,
              currency: value,
              currencies: value
                ? [...new Set([...draft.currencies, value])]
                : draft.currencies,
            })
          }
        />
      </label>
      <fieldset className="broker-currencies">
        <legend>支持币种</legend>
        {brokerCurrencies.map((currency) => (
          <label key={currency}>
            <input
              type="checkbox"
              checked={draft.currencies.includes(currency)}
              disabled={
                disabled ||
                currency === draft.currency ||
                currencyRemovalBlocked(existing, currency)
              }
              onChange={(event) =>
                onChange({
                  ...draft,
                  currencies: event.target.checked
                    ? [...draft.currencies, currency]
                    : draft.currencies.filter((value) => value !== currency),
                })
              }
            />
            {currency}
            {currencyRemovalBlocked(existing, currency)
              ? " · 已引用或范围未知"
              : ""}
          </label>
        ))}
      </fieldset>
      {existing && (
        <details>
          <summary>账户依据</summary>
          <p>账户编号 {existing.id}</p>
          <p>版本 {existing.revision}</p>
          <p>
            币种引用 {existing.currency_usage.complete ? "已核实" : "范围未知"}{" "}
            · {existing.currency_usage.reference_count} 条
          </p>
        </details>
      )}
    </>
  );
}
