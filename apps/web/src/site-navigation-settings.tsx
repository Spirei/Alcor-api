import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { legacyNavigation } from "./site-navigation";
import { SelectMenu } from "./select-menu";
import { FormActions, SettingsSurface } from "./workspace-forms";
export function SiteNavigationSettings({
  value,
  disabled,
  onChange,
  expanded = false,
}: {
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
  expanded?: boolean;
}) {
  const [addition, setAddition] = useState("");
  function move(index: number, delta: number) {
    const next = [...value],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  return (
    <SettingsSurface title="手机导航顺序" expanded={expanded}>
      {expanded && <h3>手机导航顺序</h3>}
      {value.length ? (
        <ol className="site-mobile-order">
          {value.map((key, index) => (
            <li key={key}>
              <span className="site-order-number">{index + 1}</span>
              <span className="site-mobile-label">
                {Object.hasOwn(legacyNavigation, key)
                  ? legacyNavigation[key].label
                  : key + "（尚未对应当前模块）"}
              </span>
              <div className="site-order-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`上移手机导航 ${index + 1}`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`下移手机导航 ${index + 1}`}
                  disabled={disabled || index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移出手机导航 ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="site-empty-note">暂未设置手机导航顺序</p>
      )}
      <FormActions>
        <SelectMenu
          label="加入手机导航"
          value={addition}
          disabled={disabled}
          options={[
            { value: "", label: "选择入口" },
            ...Object.entries(legacyNavigation)
              .filter(([key]) => !value.includes(key))
              .map(([key, item]) => ({ value: key, label: item.label })),
          ]}
          onChange={setAddition}
        />
        <button
          type="button"
          className="button"
          disabled={disabled || !addition}
          onClick={() => {
            onChange([...value, addition]);
            setAddition("");
          }}
        >
          <Plus size={15} aria-hidden="true" />
          加入顺序
        </button>
      </FormActions>
    </SettingsSurface>
  );
}
