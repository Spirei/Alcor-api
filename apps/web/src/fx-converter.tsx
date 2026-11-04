import { useState } from "react";
import { convertObservedFx, type ObservedRates } from "./fx-converter-state";
import { SelectMenu } from "./select-menu";

export function FxConverter({ rates }: { rates: ObservedRates | null }) {
  const [amount, setAmount] = useState("100"),
    [from, setFrom] = useState("USD");
  const codes = [
    ...new Set([
      ...(rates?.base ? [rates.base] : []),
      ...(rates?.quoted ?? []),
      ...Object.keys(rates?.rates ?? {}),
    ]),
  ].filter((code) => /^[A-Z]{3}$/.test(code));
  const choices = codes.includes(from) ? codes : [from, ...codes];
  return (
    <section className="workspace-panel fx-converter" aria-label="汇率换算">
      <div className="fx-converter-input">
        <label>
          换算金额
          <input
            aria-label="换算金额"
            inputMode="decimal"
            maxLength={44}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          基准币种
          <SelectMenu
            label="换算基准币种"
            value={from}
            onChange={setFrom}
            variant="field"
            options={choices.map((code) => ({ value: code, label: code }))}
          />
        </label>
      </div>
      <div className="fx-converter-results">
        {codes
          .filter((code) => code !== from)
          .map((code) => {
            const result = rates
              ? convertObservedFx(amount, from, code, rates)
              : null;
            return (
              <div key={code}>
                <strong>{code}</strong>
                <output aria-label={`${code} 换算结果`}>
                  {result
                    ? `${result.approximate ? "≈ " : ""}${result.value}`
                    : "—"}
                </output>
              </div>
            );
          })}
      </div>
      {!rates && <p role="status">暂无已读取汇率</p>}
    </section>
  );
}
